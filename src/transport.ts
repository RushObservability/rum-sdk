/**
 * Best-effort transport for RUM batches. Wraps the bare fetch with:
 *  - retry + exponential backoff + jitter on network errors / 429 / 5xx,
 *  - an offline buffer persisted to localStorage (drained on init + `online`),
 *  - optional gzip compression (off by default).
 *
 * Everything here is fire-and-forget: it never throws into the host app and
 * never blocks the main thread. The unload/beacon path lives in core.ts and
 * does NOT go through here (sendBeacon can't retry/compress).
 */

const BUFFER_KEY = 'rush_rum_buf_v1' // versioned so a format change can't crash older readers
const MAX_BUFFER_BYTES = 1_000_000 // ~1 MB cap across all persisted batches
const MAX_BUFFER_BATCHES = 50
const MAX_RETRIES = 3
const BASE_BACKOFF_MS = 1_000

interface PersistedBatch {
  /** Endpoint the batch was destined for. */
  url: string
  /** Already-serialized JSON payload. */
  body: string
  /** When it was first buffered (ms epoch), for oldest-first drain. */
  ts: number
}

function isOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Backoff with full jitter: random in [0, base * 2^attempt]. */
function backoffDelay(attempt: number): number {
  const ceiling = BASE_BACKOFF_MS * Math.pow(2, attempt)
  return Math.random() * ceiling
}

// ---- localStorage offline buffer -----------------------------------------

function readBuffer(): PersistedBatch[] {
  try {
    const raw = localStorage.getItem(BUFFER_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as PersistedBatch[]) : []
  } catch {
    return []
  }
}

function writeBuffer(batches: PersistedBatch[]): void {
  try {
    if (batches.length === 0) {
      localStorage.removeItem(BUFFER_KEY)
      return
    }
    localStorage.setItem(BUFFER_KEY, JSON.stringify(batches))
  } catch {
    /* storage full / unavailable — best-effort */
  }
}

/** Append a batch, dropping the oldest until under the byte + count caps. */
function persistBatch(url: string, body: string): void {
  try {
    const batches = readBuffer()
    batches.push({ url, body, ts: Date.now() })
    // Enforce count cap first (cheap), then byte cap.
    while (batches.length > MAX_BUFFER_BATCHES) batches.shift()
    let total = batches.reduce((n, b) => n + b.body.length, 0)
    while (batches.length > 1 && total > MAX_BUFFER_BYTES) {
      const dropped = batches.shift()!
      total -= dropped.body.length
    }
    writeBuffer(batches)
  } catch {
    /* best-effort */
  }
}

// ---- compression ----------------------------------------------------------

function canCompress(): boolean {
  return typeof CompressionStream !== 'undefined' && typeof Response !== 'undefined'
}

async function gzip(body: string): Promise<Blob> {
  const stream = new Blob([body]).stream().pipeThrough(new CompressionStream('gzip'))
  const buf = await new Response(stream).arrayBuffer()
  return new Blob([buf])
}

// ---- send ------------------------------------------------------------------

/**
 * Send a body once. Resolves true on a 2xx/3xx response, false on a
 * retryable failure (network error, 429, 5xx) so the caller can retry/buffer.
 * Non-retryable 4xx (other than 429) resolve true so we don't loop forever on a
 * permanently-rejected payload.
 */
async function sendOnce(url: string, body: string, compress: boolean): Promise<boolean> {
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    let payload: BodyInit = body
    if (compress && canCompress()) {
      try {
        payload = await gzip(body)
        headers['Content-Encoding'] = 'gzip'
      } catch {
        payload = body // compression failed — fall back to plain JSON
      }
    }
    const res = await fetch(url, { method: 'POST', headers, body: payload, keepalive: true })
    if (res.status === 429 || res.status >= 500) return false
    return true
  } catch {
    return false // network error → retryable
  }
}

/**
 * Send a batch with retry/backoff. If it still fails (or we're offline), the
 * batch is persisted to the offline buffer for a later drain. Never throws.
 */
export async function sendBatch(url: string, body: string, compress: boolean): Promise<void> {
  if (!isOnline()) {
    persistBatch(url, body)
    return
  }
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const ok = await sendOnce(url, body, compress)
    if (ok) return
    if (attempt < MAX_RETRIES) await sleep(backoffDelay(attempt))
  }
  // Exhausted retries — stash for later.
  persistBatch(url, body)
}

/**
 * Drain persisted batches oldest-first. Re-buffers any that still fail. Called
 * on init() and whenever the `online` event fires. Replayed batches are sent
 * uncompressed-by-default unless the caller asks to compress (we keep it simple
 * and never compress drains, since the bodies are already small JSON).
 */
export async function drainBuffer(): Promise<void> {
  if (!isOnline()) return
  let batches = readBuffer()
  if (batches.length === 0) return
  // Take a snapshot and clear storage so new live batches don't interleave;
  // anything that fails gets re-persisted below.
  writeBuffer([])
  batches = batches.sort((a, b) => a.ts - b.ts)
  for (const batch of batches) {
    if (!isOnline()) {
      persistBatch(batch.url, batch.body)
      continue
    }
    const ok = await sendOnce(batch.url, batch.body, false)
    if (!ok) persistBatch(batch.url, batch.body)
  }
}
