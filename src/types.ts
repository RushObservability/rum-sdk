export interface RushRUMConfig {
  endpoint: string
  app: { name: string; version?: string }
  environment?: string
  user?: () => { id?: string } | null
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
