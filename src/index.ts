import type { RushRUMConfig } from './types'
import { configure, flush, pushEvent, destroy, isInitialized } from './core'
import { initVitals } from './vitals'
import { initErrors } from './errors'
import { initPageViews } from './pageview'
import { initInteractions } from './interactions'
import { initResources } from './resources'
import { initReplay } from './replay'

export type { RushRUMConfig, RumEvent, RumPayload } from './types'

export const RushRUM = {
  init(config: RushRUMConfig): void {
    // No-op outside the browser (SSR / Node) so importing + init in a universal
    // app (Next.js, etc.) doesn't throw on window/navigator/history access.
    if (typeof window === 'undefined') return
    // Guard against double init() — prevents duplicate web-vitals/error/click
    // subscriptions and timers.
    if (isInitialized()) {
      console.warn('[RushRUM] init() called more than once; ignoring.')
      return
    }

    configure(config)

    if (config.trackWebVitals !== false) {
      initVitals()
    }
    if (config.trackErrors !== false) {
      initErrors()
    }
    if (config.trackPageViews !== false) {
      initPageViews()
    }
    if (config.trackInteractions === true) {
      initInteractions()
    }
    if (config.trackResources === true) {
      initResources()
    }
    if (config.trackSessionReplay === true) {
      initReplay(config)
    }
  },

  /**
   * Send a custom event.
   */
  trackEvent(name: string, attributes?: Record<string, unknown>): void {
    pushEvent({
      event_type: 'custom',
      event_name: name,
      attributes: attributes ? JSON.stringify(attributes) : undefined,
    })
  },

  /**
   * Force flush the event queue.
   */
  flush,

  /**
   * Stop collecting and detach handlers/timers. Safe to call before a later
   * init() (useful for tests and SPA hot-reload).
   */
  destroy,
}

export default RushRUM
