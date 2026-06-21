import type { RushRUMConfig } from './types'
import { configure, flush, pushEvent } from './core'
import { initVitals } from './vitals'
import { initErrors } from './errors'
import { initPageViews } from './pageview'
import { initInteractions } from './interactions'
import { initResources } from './resources'
import { initReplay } from './replay'

export type { RushRUMConfig, RumEvent, RumPayload } from './types'

export const RushRUM = {
  init(config: RushRUMConfig): void {
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
}

export default RushRUM
