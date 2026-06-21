import type { RushRUMConfig } from './types'
import {
  configure,
  flush,
  pushEvent,
  destroy as destroyCore,
  isInitialized,
  setUserOverride,
  setGlobalAttrs,
  clearGlobalAttrs,
} from './core'
import { initVitals } from './vitals'
import { initErrors, destroyErrors } from './errors'
import { initPageViews } from './pageview'
import { initInteractions, destroyInteractions } from './interactions'
import { initResources } from './resources'
import { initReplay, destroyReplay } from './replay'
import { initPerformance, destroyPerformance } from './perf'

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
    if (config.trackLongTasks !== false) {
      initPerformance()
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
   * Set or override the current user id; reflected in meta.user_id on subsequent
   * events. Overrides the config.user callback. Pass null to clear it.
   */
  setUser(user: { id?: string } | null): void {
    setUserOverride(user)
  },

  /**
   * Merge attributes into every subsequent event's `attributes` JSON.
   * Event-specific keys win over global ones.
   */
  setGlobalAttributes(attrs: Record<string, unknown>): void {
    setGlobalAttrs(attrs)
  },

  /** Clear all global attributes set via setGlobalAttributes. */
  clearGlobalAttributes(): void {
    clearGlobalAttrs()
  },

  /**
   * Force flush the event queue.
   */
  flush,

  /**
   * Stop collecting and detach handlers/timers. Safe to call before a later
   * init() (useful for tests and SPA hot-reload). Tears down every
   * instrumentation: observers, timers, and listeners.
   */
  destroy(): void {
    // Tear down instrumentation first (they call pushEvent → core), then core.
    destroyPerformance()
    destroyInteractions()
    destroyErrors()
    destroyReplay()
    destroyCore()
  },
}

export default RushRUM
