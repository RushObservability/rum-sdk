import type { RumEvent, RumMeta, RumPayload, RushRUMConfig } from './types'
import { getSessionId } from './session'
import { detectBrowser } from './browser'

const MAX_BATCH = 30
const FLUSH_INTERVAL_MS = 250

let config: RushRUMConfig | null = null
let queue: RumEvent[] = []
let flushTimer: ReturnType<typeof setTimeout> | null = null
let browserInfo: ReturnType<typeof detectBrowser> | null = null

export function configure(cfg: RushRUMConfig): void {
  config = cfg
  browserInfo = detectBrowser()
  startFlushTimer()
  setupBeaconFlush()
}

export function getConfig(): RushRUMConfig | null {
  return config
}

export function pushEvent(event: RumEvent): void {
  if (!config) return
  if (config.sampleRate !== undefined && config.sampleRate < 1) {
    if (Math.random() > config.sampleRate) return
  }

  event.timestamp = event.timestamp ?? Date.now() * 1_000_000 // ns

  queue.push(event)
  if (queue.length >= MAX_BATCH) {
    flush()
  }
}

function buildMeta(): RumMeta {
  const cfg = config!
  const bi = browserInfo!
  let userId = ''
  try {
    const u = cfg.user?.()
    userId = u?.id ?? ''
  } catch { /* ignore */ }

  return {
    app_name: cfg.app.name,
    app_version: cfg.app.version ?? '',
    environment: cfg.environment ?? '',
    session_id: getSessionId(),
    user_id: userId,
    page_url: location.href,
    page_path: location.pathname,
    view_name: document.title,
    referrer: document.referrer,
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

  const events = queue.splice(0, MAX_BATCH)
  const payload: RumPayload = {
    meta: buildMeta(),
    events,
  }

  const body = JSON.stringify(payload)

  // Try fetch first, fallback silently
  fetch(config.endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    keepalive: true,
  }).catch(() => {
    // Silently drop — RUM data is best-effort
  })
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
      // Sync XHR as last resort (not recommended but works for unload)
      try {
        const xhr = new XMLHttpRequest()
        xhr.open('POST', config.endpoint, false)
        xhr.setRequestHeader('Content-Type', 'application/json')
        xhr.send(body)
      } catch { /* ignore */ }
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') beaconFlush()
  })
  window.addEventListener('pagehide', beaconFlush)
}
