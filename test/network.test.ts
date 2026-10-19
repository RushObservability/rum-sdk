import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

beforeEach(() => {
  vi.resetModules()
  vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 204 })))
})

afterEach(() => vi.unstubAllGlobals())

describe('internal upload transport', () => {
  it('marks SDK fetches and XHR without adding HTTP headers', async () => {
    const { internalFetch, internalXHR, isInternalRequest } = await import('../src/network')
    const init = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }
    await internalFetch('/custom-ingest', init)
    const sent = vi.mocked(fetch).mock.calls[0][1]!
    expect(isInternalRequest(sent)).toBe(true)
    expect(sent.headers).toEqual(init.headers)
    expect(isInternalRequest(init)).toBe(false)
    expect(isInternalRequest(internalXHR())).toBe(true)
    expect(isInternalRequest(new XMLHttpRequest())).toBe(false)
    expect(isInternalRequest(undefined)).toBe(false)
  })

  it.each([
    ['x'.repeat(65_536), true],
    ['x'.repeat(65_537), false],
    ['é'.repeat(32_769), false],
    [new Blob(['é'.repeat(32_769)]), false],
  ])('bounds keepalive using encoded body bytes (%#)', async (body, expected) => {
    const { internalFetch } = await import('../src/network')
    await internalFetch('/upload', { method: 'POST', body, keepalive: true })
    expect(vi.mocked(fetch).mock.calls[0][1]?.keepalive).toBe(expected)
  })

  it('leaves active-page uploads outside the keepalive budget', async () => {
    const { internalFetch } = await import('../src/network')
    await internalFetch('/upload', { method: 'POST', body: 'x'.repeat(120_000) })
    expect(vi.mocked(fetch).mock.calls[0][1]?.keepalive).toBe(false)
  })

  it('shares the quota across concurrent uploads and releases it on completion', async () => {
    const { internalFetch } = await import('../src/network')
    let release!: (response: Response) => void
    vi.mocked(fetch).mockImplementationOnce(() => new Promise((resolve) => { release = resolve }))
    const first = internalFetch('/events', { method: 'POST', body: 'x'.repeat(40_000), keepalive: true })
    await internalFetch('/replay', { method: 'POST', body: 'x'.repeat(30_000), keepalive: true })
    expect(vi.mocked(fetch).mock.calls.map(([, init]) => init?.keepalive)).toEqual([true, false])
    release(new Response(null, { status: 204 }))
    await first
    await internalFetch('/replay', { method: 'POST', body: 'x'.repeat(40_000), keepalive: true })
    expect(vi.mocked(fetch).mock.calls[2][1]?.keepalive).toBe(true)
  })

  it('retries rejected keepalive without the quota and preserves the internal marker', async () => {
    const { internalFetch, isInternalRequest } = await import('../src/network')
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await internalFetch('/replay', { method: 'POST', body: '{}', keepalive: true })
    const calls = vi.mocked(fetch).mock.calls
    expect(calls.map(([, init]) => init?.keepalive)).toEqual([true, false])
    expect(calls.every(([, init]) => isInternalRequest(init))).toBe(true)
    expect(calls[1][1]?.body).toBe('{}')
  })

  it('propagates failed ordinary fetches and releases quota after a failed fallback', async () => {
    const { internalFetch } = await import('../src/network')
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError('offline'))
      .mockRejectedValueOnce(new TypeError('offline'))
    await expect(internalFetch('/replay', {
      method: 'POST', body: 'x'.repeat(50_000), keepalive: true,
    })).rejects.toThrow('offline')
    expect(fetch).toHaveBeenCalledTimes(2)
    await internalFetch('/replay', { method: 'POST', body: 'x'.repeat(50_000), keepalive: true })
    expect(vi.mocked(fetch).mock.calls[2][1]?.keepalive).toBe(true)
  })
})
