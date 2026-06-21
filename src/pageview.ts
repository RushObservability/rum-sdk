import { pushEvent } from './core'

let patched = false

export function initPageViews(): void {
  // Track initial page load
  trackPageView()

  if (patched) return // don't re-wrap history on a repeat init
  patched = true

  // SPA navigation: history.pushState / replaceState
  const origPush = history.pushState.bind(history)
  const origReplace = history.replaceState.bind(history)

  history.pushState = function (...args: Parameters<typeof origPush>) {
    origPush(...args)
    trackPageView()
  }

  history.replaceState = function (...args: Parameters<typeof origReplace>) {
    origReplace(...args)
    trackPageView()
  }

  // Back/forward navigation
  window.addEventListener('popstate', () => {
    trackPageView()
  })
}

function generateTraceId(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('')
}

function generateSpanId(): string {
  const bytes = new Uint8Array(8)
  crypto.getRandomValues(bytes)
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('')
}

function trackPageView(): void {
  const traceId = generateTraceId()
  const spanId = generateSpanId()

  pushEvent({
    event_type: 'pageview',
    event_name: document.title,
    duration_ms: getNavigationLoadTime(),
    trace_id: traceId,
    span_id: spanId,
  })
}

function getNavigationLoadTime(): number {
  if (typeof performance === 'undefined') return 0
  const entries = performance.getEntriesByType('navigation') as PerformanceNavigationTiming[]
  if (entries.length > 0) {
    return entries[0].loadEventEnd - entries[0].startTime
  }
  return 0
}
