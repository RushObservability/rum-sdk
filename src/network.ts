// Shared by all SDK upload paths. A symbol keeps the marker out of HTTP headers
// and survives RequestInit copies made by other fetch wrappers.
const INTERNAL_REQUEST = Symbol.for('RushRUM.internalRequest')
const MAX_KEEPALIVE_BYTES = 65_536
let keepaliveBytes = 0

type InternalRequest = { [INTERNAL_REQUEST]?: boolean }

export function isInternalRequest(request: object | undefined): boolean {
  return (request as InternalRequest | undefined)?.[INTERNAL_REQUEST] === true
}

/** Mark the legacy unload XHR so resource tracking skips it as well. */
export function internalXHR(): XMLHttpRequest {
  return Object.assign(new XMLHttpRequest(), { [INTERNAL_REQUEST]: true })
}

function bodyBytes(body: RequestInit['body']): number {
  if (body == null) return 0
  if (typeof body === 'string') return new Blob([body]).size
  if (body instanceof Blob) return body.size
  // Unknown encoded sizes cannot safely use the keepalive quota.
  return Infinity
}

/**
 * Upload without generating resource events or trace headers. Keepalive has a
 * shared 64 KiB browser quota, measured in encoded body bytes. Oversized bodies
 * and concurrent uploads that exceed our budget use an ordinary fetch.
 */
export async function internalFetch(url: string, init: RequestInit): Promise<Response> {
  const bytes = init.keepalive === true ? bodyBytes(init.body) : 0
  const keepalive = init.keepalive === true && keepaliveBytes + bytes <= MAX_KEEPALIVE_BYTES
  const options: RequestInit & InternalRequest = { ...init, keepalive, [INTERNAL_REQUEST]: true }
  if (keepalive) keepaliveBytes += bytes
  try {
    try {
      return await fetch(url, options)
    } catch (error) {
      if (!keepalive) throw error
      // Other code on the page can consume the browser's quota too. If a
      // keepalive request is rejected, try once without that restriction.
      return await fetch(url, { ...options, keepalive: false })
    }
  } finally {
    if (keepalive) keepaliveBytes -= bytes
  }
}
