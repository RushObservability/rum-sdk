/**
 * Long task + Long Animation Frame (LoAF) instrumentation via PerformanceObserver.
 * Lightweight and low-volume, so it's enabled by default. Both observers are
 * disconnected by destroy().
 */
import { pushEvent } from './core'

let started = false
let longTaskObserver: PerformanceObserver | null = null
let loafObserver: PerformanceObserver | null = null

function supports(type: string): boolean {
  return (
    typeof PerformanceObserver !== 'undefined' &&
    Array.isArray(PerformanceObserver.supportedEntryTypes) &&
    PerformanceObserver.supportedEntryTypes.includes(type)
  )
}

export function initPerformance(): void {
  if (started) return // single set of observers per init
  if (typeof PerformanceObserver === 'undefined') return
  started = true

  if (supports('longtask')) {
    try {
      longTaskObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          pushEvent({
            event_type: 'long_task',
            duration_ms: entry.duration,
            attributes: JSON.stringify({ start: entry.startTime, name: entry.name }),
          })
        }
      })
      longTaskObserver.observe({ type: 'longtask', buffered: true })
    } catch {
      longTaskObserver = null
    }
  }

  if (supports('long-animation-frame')) {
    try {
      loafObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          // LoAF entries carry blockingDuration + a scripts[] array; types aren't
          // in lib.dom yet, so read them defensively.
          const e = entry as PerformanceEntry & {
            blockingDuration?: number
            scripts?: unknown[]
          }
          pushEvent({
            event_type: 'loaf',
            duration_ms: e.duration,
            attributes: JSON.stringify({
              start: e.startTime,
              blockingDuration: e.blockingDuration ?? 0,
              scripts: (e.scripts || []).length,
            }),
          })
        }
      })
      loafObserver.observe({ type: 'long-animation-frame', buffered: true })
    } catch {
      loafObserver = null
    }
  }
}

export function destroyPerformance(): void {
  if (longTaskObserver) {
    longTaskObserver.disconnect()
    longTaskObserver = null
  }
  if (loafObserver) {
    loafObserver.disconnect()
    loafObserver = null
  }
  started = false
}
