import type { RumEvent, RumMeta, RumPayload, RushRUMConfig } from './types'
import { getSessionId, isSessionSampled } from './session'
import { detectBrowser } from './browser'
import { sendBatch, drainBuffer } from './transport'

const MAX_BATCH = 30
const FLUSH_INTERVAL_MS = 250
// Cap the in-memory queue so a flush outage (offline / failing backend) can't
// grow it without bound; drop oldest on overflow.
const MAX_QUEUE = 1000

let config: RushRUMConfig | null = null
let queue: RumEvent[] = []
let flushTimer: ReturnType<typeof setInterval> | null = null
let browserInfo: ReturnType<typeof detectBrowser> | null = null
let sampledIn = true
let initialized = false

// Dynamic user override (set via RushRUM.setUser) — takes precedence over the
// config.user callback when set. undefined = not overridden; null = cleared.
let userOverride: { id?: string } | null | undefined = undefined
// Global attributes merged into every event's `attributes` JSON.
let globalAttributes: Record<string, unknown> = {}

// Listener refs kept so destroy() can detach them.
let onVisibility: (() => void) | null = null
let onPageHide: (() => void) | null = null
let onOnline: (() => void) | null = null

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
  setupOnlineDrain()
  // Drain anything buffered offline on a previous load (oldest first).
  void drainBuffer()
}

/** Set/override the current user id; reflected in meta.user_id. null clears it. */
export function setUserOverride(user: { id?: string } | null): void {
  userOverride = user
}

export function setGlobalAttrs(attrs: Record<string, unknown>): void {
  globalAttributes = { ...globalAttributes, ...attrs }
}

export function clearGlobalAttrs(): void {
  globalAttributes = {}
}

/**
 * Merge global attributes into an event's `attributes` JSON. Event-specific keys
 * win over globals. No-op when there are no globals. Parse failures fall back to
 * keeping the event's original attributes untouched.
 */
function applyGlobalAttributes(event: RumEvent): void {
  const keys = Object.keys(globalAttributes)
  if (keys.length === 0) return
  let existing: Record<string, unknown> = {}
  if (event.attributes) {
    try {
      const parsed = JSON.parse(event.attributes)
      if (parsed && typeof parsed === 'object') existing = parsed as Record<string, unknown>
    } catch {
      return // unparseable existing attributes — leave them as-is
    }
  }
  event.attributes = JSON.stringify({ ...globalAttributes, ...existing })
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

  // beforeSend may mutate or drop the event. A throwing hook must never break
  // collection, so swallow errors and keep the (un-hooked) event.
  if (config.beforeSend) {
    try {
      const result = config.beforeSend(event)
      if (result === null) return // explicitly dropped
      event = result ?? event
    } catch {
      /* ignore a misbehaving beforeSend */
    }
  }

  // Merge global attributes (event-specific keys win) into the stringified JSON.
  applyGlobalAttributes(event)

  queue.push(event)
  // Cap the queue: drop oldest first so the newest signal survives a backlog.
  if (queue.length > MAX_QUEUE) queue.splice(0, queue.length - MAX_QUEUE)
  if (queue.length >= MAX_BATCH) flush()
}

function buildMeta(): RumMeta {
  const cfg = config!
  const bi = browserInfo!
  let userId = ''
  // setUser() override (when set) wins over the config.user callback.
  if (userOverride !== undefined) {
    userId = userOverride?.id ?? ''
  } else {
    try {
      const u = cfg.user?.()
      userId = u?.id ?? ''
    } catch {
      /* ignore */
    }
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
  const endpoint = config.endpoint
  const compress = config.compress === true
  // Drain in batches so a burst doesn't leave a remainder waiting for the timer.
  while (queue.length > 0) {
    const events = queue.splice(0, MAX_BATCH)
    const payload: RumPayload = { meta: buildMeta(), events }
    const body = JSON.stringify(payload)
    // Transport handles retry/backoff + offline buffering; fire-and-forget.
    void sendBatch(endpoint, body, compress)
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

/** Drain the offline buffer whenever connectivity is restored. */
function setupOnlineDrain(): void {
  if (typeof window === 'undefined') return
  onOnline = () => {
    void drainBuffer()
  }
  window.addEventListener('online', onOnline)
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
  if (typeof window !== 'undefined' && onOnline) {
    window.removeEventListener('online', onOnline)
  }
  onVisibility = null
  onPageHide = null
  onOnline = null
  queue = []
  config = null
  initialized = false
  userOverride = undefined
  globalAttributes = {}
}
