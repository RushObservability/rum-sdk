/**
 * Session replay recorder — captures rrweb DOM snapshots and mutation events
 * and streams them in chunks to the Rush replay ingest endpoint.
 *
 * Must be called only after `configure()` (i.e. inside `RushRUM.init`).
 */
import type { RushRUMConfig } from './types'
import { getSessionId } from './session'

const CHUNK_SIZE = 50          // flush after this many events
const FLUSH_INTERVAL_MS = 5_000 // flush every 5 s regardless

let _config: RushRUMConfig | null = null
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _buffer: any[] = []
let _chunkIdx = 0
let _flushTimer: ReturnType<typeof setInterval> | null = null

function replayEndpoint(): string {
  const cfg = _config!
  if (cfg.replayEndpoint) return cfg.replayEndpoint
  // Derive from the event ingest endpoint: replace /rum/ingest with /rum/replay/ingest
  return cfg.endpoint.replace(/\/rum\/ingest$/, '/rum/replay/ingest')
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function sendChunk(events: any[]): void {
  if (!_config || events.length === 0) return
  const payload = {
    session_id: getSessionId(),
    app_name: _config.app.name,
    chunk_idx: _chunkIdx++,
    events,
  }
  fetch(replayEndpoint(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    keepalive: true,
  }).catch(() => { /* best-effort */ })
}

function flushBuffer(): void {
  if (_buffer.length === 0) return
  sendChunk(_buffer.splice(0))
}

export function initReplay(config: RushRUMConfig): void {
  _config = config

  // Dynamically import rrweb so it doesn't bloat pages that don't enable replay
  import('rrweb').then(({ record }) => {
    record({
      emit(event) {
        _buffer.push(event)
        if (_buffer.length >= CHUNK_SIZE) {
          flushBuffer()
        }
      },
      maskAllInputs: true,     // mask form fields for privacy
      maskTextSelector: '[data-pii]', // opt-in masking of PII text nodes
    })
  }).catch(() => {
    // rrweb not installed — replay silently disabled
  })

  _flushTimer = setInterval(flushBuffer, FLUSH_INTERVAL_MS)

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushBuffer()
  })
  window.addEventListener('pagehide', flushBuffer)
}
