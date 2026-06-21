import { pushEvent, getConfig, sanitizeUrl } from './core'

let patched = false

export function initResources(): void {
  if (patched) return // never double-wrap fetch/XHR
  patched = true
  patchFetch()
  patchXHR()
}

function shouldTraceOrigin(url: string): boolean {
  const cfg = getConfig()
  if (!cfg?.propagateTraces?.origins) return false
  return cfg.propagateTraces.origins.some((re) => re.test(url))
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

function patchFetch(): void {
  const origFetch = window.fetch.bind(window)

  window.fetch = async function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const start = performance.now()

    let traceId = ''
    let spanId = ''

    if (shouldTraceOrigin(url)) {
      traceId = generateTraceId()
      spanId = generateSpanId()
      const headers = new Headers(init?.headers)
      headers.set('traceparent', `00-${traceId}-${spanId}-01`)
      init = { ...init, headers }
    }

    try {
      const response = await origFetch(input, init)
      const durationMs = performance.now() - start

      pushEvent({
        event_type: 'resource',
        event_name: sanitizeUrl(url),
        duration_ms: durationMs,
        trace_id: traceId,
        span_id: spanId,
        attributes: JSON.stringify({ status: response.status, method: init?.method ?? 'GET' }),
      })

      return response
    } catch (err) {
      const durationMs = performance.now() - start
      pushEvent({
        event_type: 'resource',
        event_name: sanitizeUrl(url),
        duration_ms: durationMs,
        trace_id: traceId,
        span_id: spanId,
        error_message: err instanceof Error ? err.message : 'fetch failed',
        error_type: 'NetworkError',
      })
      throw err
    }
  }
}

function patchXHR(): void {
  const origOpen = XMLHttpRequest.prototype.open
  const origSend = XMLHttpRequest.prototype.send

  XMLHttpRequest.prototype.open = function (method: string, url: string | URL, ...rest: any[]) {
    (this as any).__wide_url = typeof url === 'string' ? url : url.href;
    (this as any).__wide_method = method
    return origOpen.apply(this, [method, url, ...rest] as any)
  }

  XMLHttpRequest.prototype.send = function (body?: any) {
    const url: string = (this as any).__wide_url ?? ''
    const method: string = (this as any).__wide_method ?? 'GET'
    const start = performance.now()

    let traceId = ''
    let spanId = ''
    if (shouldTraceOrigin(url)) {
      traceId = generateTraceId()
      spanId = generateSpanId()
      this.setRequestHeader('traceparent', `00-${traceId}-${spanId}-01`)
    }

    this.addEventListener('loadend', () => {
      const durationMs = performance.now() - start
      pushEvent({
        event_type: 'resource',
        event_name: sanitizeUrl(url),
        duration_ms: durationMs,
        trace_id: traceId,
        span_id: spanId,
        attributes: JSON.stringify({ status: this.status, method }),
      })
    })

    return origSend.call(this, body)
  }
}
