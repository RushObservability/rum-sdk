export interface RushRUMConfig {
  endpoint: string
  app: { name: string; version?: string }
  environment?: string
  user?: () => { id?: string } | null
  /**
   * Fraction of sessions to record, 0..1 (default 1). The decision is made ONCE
   * per session and applied to every event in it — so sessions stay coherent
   * (you never keep a pageview but drop its errors).
   */
  sampleRate?: number
  trackWebVitals?: boolean
  trackErrors?: boolean
  trackInteractions?: boolean
  trackResources?: boolean
  trackPageViews?: boolean
  propagateTraces?: { origins: RegExp[] }
  trackSessionReplay?: boolean
  /** Override the replay ingest endpoint (defaults to endpoint with /rum/replay/ingest) */
  replayEndpoint?: string
  /**
   * Keep query strings + hash on captured URLs (page_url + resource URLs).
   * Default false → they are stripped, since query params often carry tokens/PII.
   */
  captureQueryParams?: boolean
  /**
   * Drop the visible text of clicked elements from interaction events (keeps only
   * tag/id/classes). Default false. Enable if button/link text may contain PII.
   */
  maskInteractionText?: boolean
  /**
   * Track long tasks (>50ms) and Long Animation Frames (LoAF) via
   * PerformanceObserver. Default true — lightweight and low-volume.
   */
  trackLongTasks?: boolean
  /**
   * gzip the request body via CompressionStream and set Content-Encoding: gzip.
   * Default false. ONLY enable if your ingest endpoint decodes gzip — the current
   * Rush backend does not, so leaving this off keeps bodies plain JSON. The
   * unload/beacon path is always sent uncompressed.
   */
  compress?: boolean
  /**
   * Mutate or drop events before they are queued. Return the (possibly mutated)
   * event to keep it, or null to drop it. Thrown errors are swallowed so a buggy
   * hook never breaks collection.
   */
  beforeSend?: (event: RumEvent) => RumEvent | null
  /**
   * Replay privacy level (default 'mask'). Controls rrweb masking:
   * - 'mask': mask all inputs + all text + block media (private by default).
   * - 'mask-user-input': mask all inputs only, leave text visible.
   * - 'allow': no masking.
   */
  replayPrivacy?: 'mask' | 'mask-user-input' | 'allow'
  /** Extra CSS selector for text/elements to mask in replay (merged with [data-pii]). */
  replayMaskSelector?: string
  /** Extra CSS selector for elements to block (not record) in replay. */
  replayBlockSelector?: string
  /** Extra CSS selector for text to leave un-masked in replay (overrides masking). */
  replayUnmaskSelector?: string
  /**
   * Scrub or drop replay events client-side before they are buffered. Return the
   * (possibly mutated) event to keep it, or null to drop it. Analogous to
   * Sentry's beforeAddRecordingEvent. Thrown errors are swallowed.
   */
  replayBeforeAddEvent?: (event: unknown) => unknown | null
}

export interface RumMeta {
  app_name: string
  app_version: string
  environment: string
  session_id: string
  user_id: string
  page_url: string
  page_path: string
  view_name: string
  referrer: string
  browser_name: string
  browser_version: string
  os_name: string
  os_version: string
  device_type: string
  screen_width: number
  screen_height: number
}

export interface RumEvent {
  event_type: string
  event_name?: string
  timestamp?: number
  vital_name?: string
  vital_value?: number
  vital_rating?: string
  error_message?: string
  error_stack?: string
  error_type?: string
  interaction_target?: string
  interaction_type?: string
  duration_ms?: number
  trace_id?: string
  span_id?: string
  attributes?: string
}

export interface RumPayload {
  meta: RumMeta
  events: RumEvent[]
}
