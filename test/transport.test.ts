import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// transport.ts has no module state of its own (the buffer lives in
// localStorage), but it uses setTimeout for backoff. We fake timers and flush
// them so retries don't actually wait.
async function freshTransport() {
  vi.resetModules()
  return import('../src/transport')
}

const BUFFER_KEY = 'rush_rum_buf_v1'
const URL = 'https://example.test/rum/ingest'

function setOnline(online: boolean) {
  Object.defineProperty(navigator, 'onLine', { value: online, configurable: true })
}

function readBuffer(): any[] {
  const raw = localStorage.getItem(BUFFER_KEY)
  return raw ? JSON.parse(raw) : []
}

beforeEach(() => {
  localStorage.clear()
  setOnline(true)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

/**
 * Run a promise to completion while draining fake timers. sendBatch schedules a
 * fresh backoff timer after each failed attempt, so we loop runAllTimersAsync
 * (which flushes microtasks + every currently-pending timer) until the promise
 * settles.
 */
async function runWithTimers<T>(p: Promise<T>): Promise<T> {
  let settled = false
  const wrapped = p.then(
    (v) => {
      settled = true
      return v
    },
    (e) => {
      settled = true
      throw e
    },
  )
  // Bound the loop so a bug can't hang the test runner forever.
  for (let i = 0; i < 20 && !settled; i++) {
    await vi.runAllTimersAsync()
  }
  return wrapped
}

describe('sendBatch retry', () => {
  it('retries on 5xx then 429 and finally succeeds', async () => {
    vi.useFakeTimers()
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 500 }))
      .mockResolvedValueOnce(new Response(null, { status: 429 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const t = await freshTransport()
    const promise = t.sendBatch(URL, '{"ok":1}', false)
    await runWithTimers(promise)

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(readBuffer()).toEqual([]) // succeeded → nothing buffered
  })

  it('persists to the offline buffer after exhausting retries', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 503 }))
    vi.stubGlobal('fetch', fetchMock)

    const t = await freshTransport()
    const promise = t.sendBatch(URL, '{"x":1}', false)
    await runWithTimers(promise)

    // MAX_RETRIES = 3 → 4 attempts total (0..3).
    expect(fetchMock).toHaveBeenCalledTimes(4)
    const buf = readBuffer()
    expect(buf).toHaveLength(1)
    expect(buf[0].body).toBe('{"x":1}')
    expect(buf[0].url).toBe(URL)
  })

  it('buffers immediately without fetching when offline', async () => {
    setOnline(false)
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const t = await freshTransport()
    await t.sendBatch(URL, '{"y":2}', false)

    expect(fetchMock).not.toHaveBeenCalled()
    const buf = readBuffer()
    expect(buf).toHaveLength(1)
    expect(buf[0].body).toBe('{"y":2}')
  })

  it('treats a non-429 4xx as terminal success (no buffer)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 400 }))
    vi.stubGlobal('fetch', fetchMock)

    const t = await freshTransport()
    await t.sendBatch(URL, '{"z":3}', false)

    expect(fetchMock).toHaveBeenCalledTimes(1) // no retry on 400
    expect(readBuffer()).toEqual([])
  })
})

describe('drainBuffer', () => {
  it('drains oldest-first and clears the buffer on success', async () => {
    const order: string[] = []
    const fetchMock = vi.fn(async (_url: string, init: any) => {
      order.push(JSON.parse(init.body).n)
      return new Response(null, { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    // Seed buffer out of order; drain must sort by ts ascending.
    localStorage.setItem(
      BUFFER_KEY,
      JSON.stringify([
        { url: URL, body: '{"n":"newer"}', ts: 200 },
        { url: URL, body: '{"n":"older"}', ts: 100 },
      ]),
    )

    const t = await freshTransport()
    await t.drainBuffer()

    expect(order).toEqual(['older', 'newer'])
    expect(readBuffer()).toEqual([]) // cleared on full success
  })

  it('re-persists batches that still fail', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 500 }))
    vi.stubGlobal('fetch', fetchMock)

    localStorage.setItem(
      BUFFER_KEY,
      JSON.stringify([{ url: URL, body: '{"n":"a"}', ts: 1 }]),
    )

    const t = await freshTransport()
    await t.drainBuffer()

    const buf = readBuffer()
    expect(buf).toHaveLength(1)
    expect(buf[0].body).toBe('{"n":"a"}') // re-persisted after failure
  })

  it('does nothing while offline', async () => {
    setOnline(false)
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    localStorage.setItem(
      BUFFER_KEY,
      JSON.stringify([{ url: URL, body: '{"n":"a"}', ts: 1 }]),
    )

    const t = await freshTransport()
    await t.drainBuffer()

    expect(fetchMock).not.toHaveBeenCalled()
    expect(readBuffer()).toHaveLength(1) // untouched
  })
})

describe('offline buffer caps', () => {
  it('drops oldest batches beyond the count cap (50)', async () => {
    setOnline(false)
    vi.stubGlobal('fetch', vi.fn())

    const t = await freshTransport()
    // Push 55 small batches while offline; cap is 50 → oldest 5 dropped.
    for (let i = 0; i < 55; i++) {
      await t.sendBatch(URL, JSON.stringify({ i }), false)
    }
    const buf = readBuffer()
    expect(buf.length).toBe(50)
    // Oldest surviving is i=5, newest is i=54.
    expect(JSON.parse(buf[0].body).i).toBe(5)
    expect(JSON.parse(buf[buf.length - 1].body).i).toBe(54)
  })

  it('drops oldest batches beyond the byte cap (~1MB)', async () => {
    setOnline(false)
    vi.stubGlobal('fetch', vi.fn())

    const t = await freshTransport()
    // ~300KB per batch; 5 batches = ~1.5MB > 1MB cap → oldest dropped.
    const big = 'x'.repeat(300_000)
    for (let i = 0; i < 5; i++) {
      await t.sendBatch(URL, JSON.stringify({ i, big }), false)
    }
    const buf = readBuffer()
    const total = buf.reduce((n: number, b: any) => n + b.body.length, 0)
    expect(total).toBeLessThanOrEqual(1_000_000)
    // Newest batch always survives.
    expect(JSON.parse(buf[buf.length - 1].body).i).toBe(4)
  })
})
