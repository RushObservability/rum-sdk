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
