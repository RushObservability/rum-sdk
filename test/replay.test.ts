import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const recorder = vi.hoisted(() => ({ record: vi.fn(), stop: vi.fn() }))
vi.mock('rrweb', () => ({ record: recorder.record }))

let replay: typeof import('../src/replay')
let emit: (event: unknown) => void

beforeEach(async () => {
  vi.resetModules()
  vi.useFakeTimers()
  recorder.record.mockImplementation((options) => {
    emit = options.emit
    return recorder.stop
  })
  vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 204 })))
  replay = await import('../src/replay')
  replay.initReplay({ endpoint: '/rum/ingest', app: { name: 'test' } })
  await vi.dynamicImportSettled()
})

afterEach(() => {
  replay.destroyReplay()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('replay uploads', () => {
  it('sends a large full snapshot immediately without keepalive', () => {
    emit({ type: 4, data: { href: location.href } })
    const snapshot = { type: 2, data: { text: 'x'.repeat(120_000) } }
    emit(snapshot)
    expect(fetch).toHaveBeenCalledTimes(1)
    const [url, init] = vi.mocked(fetch).mock.calls[0]
    expect(url).toBe('/rum/replay/ingest')
    expect(init?.keepalive).toBe(false)
    expect(JSON.parse(init?.body as string).events).toEqual([
      { type: 4, data: { href: location.href } }, snapshot,
    ])
  })

  it('flushes incremental events on the interval with ordinary fetch', async () => {
    emit({ type: 3, data: { text: 'é'.repeat(40_000) } })
    await vi.advanceTimersByTimeAsync(5_000)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(vi.mocked(fetch).mock.calls[0][1]?.keepalive).toBe(false)
  })

  it('flushes at the event count threshold and does not resend on pagehide', () => {
    for (let i = 0; i < 50; i++) emit({ type: 3, data: { i } })
    window.dispatchEvent(new Event('pagehide'))
    expect(fetch).toHaveBeenCalledTimes(1)
    const init = vi.mocked(fetch).mock.calls[0][1]!
    expect(init.keepalive).toBe(false)
    expect(JSON.parse(init.body as string).events).toHaveLength(50)
  })

  it('uses keepalive for a small final chunk and detaches its listeners', () => {
    emit({ type: 3, data: {} })
    window.dispatchEvent(new Event('pagehide'))
    expect(vi.mocked(fetch).mock.calls[0][1]?.keepalive).toBe(true)
    replay.destroyReplay()
    window.dispatchEvent(new Event('pagehide'))
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(recorder.stop).toHaveBeenCalledTimes(1)
  })

  it('uses ordinary fetch for an oversized final chunk', () => {
    emit({ type: 3, data: { text: 'é'.repeat(40_000) } })
    window.dispatchEvent(new Event('pagehide'))
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(vi.mocked(fetch).mock.calls[0][1]?.keepalive).toBe(false)
  })

  it('handles failed uploads without throwing into the application', async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError('offline'))
    emit({ type: 2, data: {} })
    await vi.advanceTimersByTimeAsync(0)
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
