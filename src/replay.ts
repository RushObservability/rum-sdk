/**
 * Session replay recorder — captures rrweb DOM snapshots and mutation events
 * and streams them in chunks to the Rush replay ingest endpoint.
 *
 * Must be called only after `configure()` (i.e. inside `RushRUM.init`).
 *
 * Privacy is on by default: unless config.replayPrivacy is set to something
 * looser, all inputs AND all text are masked and media is blocked.
 */
import type { RushRUMConfig } from './types'
import { getSessionId } from './session'

const CHUNK_SIZE = 50          // flush after this many events
const FLUSH_INTERVAL_MS = 5_000 // flush every 5 s regardless

// Always-on PII mask + the media elements blocked at the strictest level.
const PII_SELECTOR = '[data-pii]'
const MEDIA_BLOCK_SELECTOR = 'img,video,audio,picture,source,canvas'

let started = false
let _config: RushRUMConfig | null = null
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _buffer: any[] = []
let _chunkIdx = 0
let _flushTimer: ReturnType<typeof setInterval> | null = null
// rrweb's record() returns a stop function; captured so destroy() can call it.
let _stopRecording: (() => void) | null = null

let _onVisibility: (() => void) | null = null
let _onPageHide: (() => void) | null = null

function replayEndpoint(): string {
  const cfg = _config!
  if (cfg.replayEndpoint) return cfg.replayEndpoint
  // Derive from the event ingest endpoint: replace /rum/ingest with /rum/replay/ingest
  return cfg.endpoint.replace(/\/rum\/ingest$/, '/rum/replay/ingest')
}

/** Join non-empty CSS selectors into one comma-separated selector string. */
function joinSelectors(...parts: Array<string | undefined>): string {
  return parts.filter((p): p is string => !!p && p.length > 0).join(',')
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

/**
 * Map the privacy level + extra selectors to rrweb record() options.
 * - 'mask' (default): maskAllInputs + mask all text + block media.
 * - 'mask-user-input': maskAllInputs only.
 * - 'allow': no masking.
 * [data-pii] is always masked. replayUnmaskSelector overrides masking.
 */
function buildRecordOptions(cfg: RushRUMConfig): {
  maskAllInputs: boolean
  maskTextSelector: string
  blockSelector: string
} {
  const level = cfg.replayPrivacy ?? 'mask'

  let maskAllInputs = true
  let maskText = false
  let blockMedia = false
  if (level === 'mask') {
    maskAllInputs = true
    maskText = true
    blockMedia = true
  } else if (level === 'mask-user-input') {
    maskAllInputs = true
    maskText = false
  } else {
    // 'allow'
    maskAllInputs = false
    maskText = false
  }

  // Text masking: '*' masks everything; otherwise mask only PII + caller's
  // extra selector. The always-on [data-pii] is included regardless of level.
  const maskTextSelector = maskText
    ? '*'
    : joinSelectors(PII_SELECTOR, cfg.replayMaskSelector)

  const blockSelector = joinSelectors(
    blockMedia ? MEDIA_BLOCK_SELECTOR : undefined,
    cfg.replayBlockSelector,
  )

  return { maskAllInputs, maskTextSelector, blockSelector }
}

export function initReplay(config: RushRUMConfig): void {
  if (started) return // idempotent: one recorder per init
  started = true
  _config = config

  const opts = buildRecordOptions(config)
  const unmask = config.replayUnmaskSelector

  // Dynamically import rrweb so it doesn't bloat pages that don't enable replay
  import('rrweb').then(({ record }) => {
    if (!started) return // destroyed before the import resolved
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const recordOptions: Record<string, any> = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      emit(event: any) {
        // Let the caller scrub or drop replay events before buffering.
        if (config.replayBeforeAddEvent) {
          try {
            const result = config.replayBeforeAddEvent(event)
            if (result === null) return
            event = result ?? event
          } catch {
            /* ignore a misbehaving hook */
          }
        }
        _buffer.push(event)
        if (_buffer.length >= CHUNK_SIZE) flushBuffer()
      },
      maskAllInputs: opts.maskAllInputs,
    }
    if (opts.maskTextSelector) recordOptions.maskTextSelector = opts.maskTextSelector
    if (opts.blockSelector) recordOptions.blockSelector = opts.blockSelector
    // rrweb (alpha) has no native unmask selector. When text masking is on
    // (maskTextSelector === '*'), approximate unmask by returning original text
    // for nodes matching the unmask selector and masking everything else.
    if (unmask && opts.maskTextSelector === '*') {
      recordOptions.maskTextFn = (text: string, el: Element | null): string => {
        try {
          if (el && el.matches && el.matches(unmask)) return text
        } catch {
          /* invalid selector — fall through to masked */
        }
        return text.replace(/\S/g, '*')
      }
    }

    const stop = record(recordOptions)
    _stopRecording = typeof stop === 'function' ? stop : null
  }).catch(() => {
    // rrweb not installed — replay silently disabled
  })

  _flushTimer = setInterval(flushBuffer, FLUSH_INTERVAL_MS)

  _onVisibility = () => {
    if (document.visibilityState === 'hidden') flushBuffer()
  }
  _onPageHide = flushBuffer
  document.addEventListener('visibilitychange', _onVisibility)
  window.addEventListener('pagehide', _onPageHide)
}

/** Stop the rrweb recorder, flush remaining events, and detach listeners/timers. */
export function destroyReplay(): void {
  if (_stopRecording) {
    try {
      _stopRecording()
    } catch {
      /* ignore */
    }
    _stopRecording = null
  }
  if (_flushTimer) {
    clearInterval(_flushTimer)
    _flushTimer = null
  }
  flushBuffer()
  if (typeof document !== 'undefined' && _onVisibility) {
    document.removeEventListener('visibilitychange', _onVisibility)
  }
  if (typeof window !== 'undefined' && _onPageHide) {
    window.removeEventListener('pagehide', _onPageHide)
  }
  _onVisibility = null
  _onPageHide = null
  _buffer = []
  _config = null
  started = false
}
