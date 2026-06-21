import type { RumEvent, RumMeta, RumPayload, RushRUMConfig } from './types'
import { getSessionId, isSessionSampled } from './session'
import { detectBrowser } from './browser'

const MAX_BATCH = 30
const FLUSH_INTERVAL_MS = 250

let config: RushRUMConfig | null = null
let queue: RumEvent[] = []
let flushTimer: ReturnType<typeof setInterval> | null = null
let browserInfo: ReturnType<typeof detectBrowser> | null = null
let sampledIn = true
let initialized = false

// Listener refs kept so destroy() can detach them.
let onVisibility: (() => void) | null = null
let onPageHide: (() => void) | null = null

export function configure(cfg: RushRUMConfig): void {
  // Idempotent: a second init() is a no-op, so we never start duplicate timers,
  // handlers, or (via the trackers) double-wrap fetch/XHR/history.
  if (initialized) return
  config = cfg
  browserInfo = detectBrowser()
  // Sampling is decided ONCE per session and applied to every event.
  sampledIn = isSessionSampled(cfg.sampleRate ?? 1)
  initialized = true
  startFlushTimer()
  setupBeaconFlush()
}

export function getConfig(): RushRUMConfig | null {
  return config
}

export function isInitialized(): boolean {
  return initialized
}

/** Strip query string + hash from a URL unless the caller opted in via config. */
export function sanitizeUrl(url: string): string {
  if (config?.captureQueryParams) return url
  let end = url.length
  const q = url.indexOf('?')
  const h = url.indexOf('#')
  if (q !== -1) end = Math.min(end, q)
  if (h !== -1) end = Math.min(end, h)
  return url.slice(0, end)
}

/**
 * High-resolution wall-clock time in nanoseconds (backend stores i64 ns).
 * timeOrigin + now() captures sub-millisecond ordering; the float quantizes at
 * ~256ns at this magnitude, which is far finer than RUM needs.
 */
function nowNs(): number {
  const ms =
    typeof performance !== 'undefined' && performance.timeOrigin
      ? performance.timeOrigin + performance.now()
      : Date.now()
  return Math.round(ms * 1_000_000)
}

export function pushEvent(event: RumEvent): void {
  if (!config || !sampledIn) return
  event.timestamp = event.timestamp ?? nowNs()
  queue.push(event)
  if (queue.length >= MAX_BATCH) flush()
}

function buildMeta(): RumMeta {
  const cfg = config!
  const bi = browserInfo!
  let userId = ''
  try {
    const u = cfg.user?.()
    userId = u?.id ?? ''
  } catch {
    /* ignore */
  }

  return {
    app_name: cfg.app.name,
    app_version: cfg.app.version ?? '',
    environment: cfg.environment ?? '',
    session_id: getSessionId(),
    user_id: userId,
    page_url: sanitizeUrl(location.href),
    page_path: location.pathname,
    view_name: document.title,
    referrer: sanitizeUrl(document.referrer),
    browser_name: bi.browserName,
    browser_version: bi.browserVersion,
    os_name: bi.osName,
    os_version: bi.osVersion,
    device_type: bi.deviceType,
    screen_width: bi.screenWidth,
    screen_height: bi.screenHeight,
  }
}

export function flush(): void {
  if (!config || queue.length === 0) return
  // Drain in batches so a burst doesn't leave a remainder waiting for the timer.
  while (queue.length > 0) {
    const events = queue.splice(0, MAX_BATCH)
    const payload: RumPayload = { meta: buildMeta(), events }
    const body = JSON.stringify(payload)
    fetch(config.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => {
      // Silently drop — RUM data is best-effort.
    })
  }
}

function startFlushTimer(): void {
  if (flushTimer) return
  flushTimer = setInterval(() => {
    if (queue.length > 0) flush()
  }, FLUSH_INTERVAL_MS)
}

function setupBeaconFlush(): void {
  if (typeof document === 'undefined') return

  const beaconFlush = () => {
    if (!config || queue.length === 0) return
    const events = queue.splice(0)
    const payload: RumPayload = { meta: buildMeta(), events }
    const body = JSON.stringify(payload)

    if (navigator.sendBeacon) {
      navigator.sendBeacon(config.endpoint, body)
    } else {
      // Sync XHR as last resort (not recommended but works for unload).
      try {
        const xhr = new XMLHttpRequest()
        xhr.open('POST', config.endpoint, false)
        xhr.setRequestHeader('Content-Type', 'application/json')
        xhr.send(body)
      } catch {
        /* ignore */
      }
    }
  }

  onVisibility = () => {
    if (document.visibilityState === 'hidden') beaconFlush()
  }
  onPageHide = beaconFlush
  document.addEventListener('visibilitychange', onVisibility)
  window.addEventListener('pagehide', onPageHide)
}

/**
 * Stop collecting: flush the queue, clear the timer, and detach the unload
 * handlers. The fetch/XHR/history/click patches installed by the trackers stay
 * in place but become inert (pushEvent no-ops once config is null), so calling
 * init() again later is safe. Mainly for tests and SPA hot-reload.
 */
export function destroy(): void {
  flush()
  if (flushTimer) {
    clearInterval(flushTimer)
    flushTimer = null
  }
  if (typeof document !== 'undefined' && onVisibility) {
    document.removeEventListener('visibilitychange', onVisibility)
  }
  if (typeof window !== 'undefined' && onPageHide) {
    window.removeEventListener('pagehide', onPageHide)
  }
  onVisibility = null
  onPageHide = null
  queue = []
  config = null
  initialized = false
}
