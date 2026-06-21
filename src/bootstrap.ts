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
import { initPerformance, destroyPerformance } from './perf'

/**
 * Optional session-replay module, injected by the build entry. The full npm
 * build (index.ts) passes the rrweb-backed replay module; the lean CDN build
 * (global.ts) passes nothing — so replay.ts (and therefore rrweb) is never part
 * of that bundle's import graph, keeping the CDN file small.
 */
export interface ReplayModule {
  init: (config: RushRUMConfig) => void
  destroy: () => void
}

/**
 * Build the RushRUM API object. Replay is injected (or omitted) so the same
 * core can ship as a full npm package or a lean replay-less CDN bundle.
 */
export function makeRushRUM(replay?: ReplayModule) {
  return {
    init(config: RushRUMConfig): void {
      // No-op outside the browser (SSR / Node) so importing + init in a universal
      // app (Next.js, etc.) doesn't throw on window/navigator/history access.
      if (typeof window === 'undefined') return
      // Guard against double init() — prevents duplicate subscriptions/timers.
      if (isInitialized()) {
        console.warn('[RushRUM] init() called more than once; ignoring.')
        return
      }

      configure(config)

      if (config.trackWebVitals !== false) initVitals()
      if (config.trackErrors !== false) initErrors()
      if (config.trackPageViews !== false) initPageViews()
      if (config.trackLongTasks !== false) initPerformance()
      if (config.trackInteractions === true) initInteractions()
      if (config.trackResources === true) initResources()
      if (config.trackSessionReplay === true) {
        if (replay) {
          replay.init(config)
        } else {
          console.warn('[RushRUM] session replay is not available in this build; use the npm package (@rushobservability/rum-sdk).')
        }
      }
    },

    /** Send a custom event. */
    trackEvent(name: string, attributes?: Record<string, unknown>): void {
      pushEvent({
        event_type: 'custom',
        event_name: name,
        attributes: attributes ? JSON.stringify(attributes) : undefined,
      })
    },

    /**
     * Set or override the current user id; reflected in meta.user_id on
     * subsequent events. Overrides the config.user callback. Pass null to clear.
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

    /** Force flush the event queue. */
    flush,

    /**
     * Stop collecting and detach handlers/timers. Safe to call before a later
     * init() (tests, SPA hot-reload). Tears down every instrumentation.
     */
    destroy(): void {
      // Tear down instrumentation first (they call pushEvent → core), then core.
      destroyPerformance()
      destroyInteractions()
      destroyErrors()
      if (replay) replay.destroy()
      destroyCore()
    },
  }
}
