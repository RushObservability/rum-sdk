import { test, expect } from '@playwright/test'
import { build } from 'esbuild'
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http'
import { fileURLToPath } from 'node:url'
import type { RumEvent } from '../../src/types'

declare global {
  interface Window {
    sdkTest: {
      RushRUM: typeof import('../../src/index').RushRUM
      sendBatch: typeof import('../../src/transport').sendBatch
      drainBuffer: typeof import('../../src/transport').drainBuffer
      internalFetch: typeof import('../../src/network').internalFetch
    }
    events: RumEvent[]
  }
}

type Upload = { path: string; body: string; headers: IncomingHttpHeaders }
let server: Server
let origin: string
let uploads: Upload[] = []

test.beforeAll(async () => {
  const bundle = await build({
    stdin: {
      contents: `
        import { RushRUM } from './src/index'
        import { sendBatch, drainBuffer } from './src/transport'
        import { internalFetch } from './src/network'
        window.sdkTest = { RushRUM, sendBatch, drainBuffer, internalFetch }
      `,
      resolveDir: fileURLToPath(new URL('../../', import.meta.url)),
      loader: 'ts',
    },
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
  })
  server = createServer(async (req, res) => {
    if (req.url === '/sdk.js') {
      res.writeHead(200, { 'Content-Type': 'text/javascript' }).end(bundle.outputFiles[0].text)
      return
    }
    if (req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html' })
        .end('<!doctype html><title>SDK regression fixture</title><script src="/sdk.js"></script>')
      return
    }
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(Buffer.from(chunk))
    const body = Buffer.concat(chunks).toString()
    if (req.url?.startsWith('/echo')) {
      res.writeHead(200, { 'Content-Type': 'application/json' })
        .end(JSON.stringify({ headers: req.headers, method: req.method, body }))
      return
    }
    if (req.method !== 'POST') {
      res.writeHead(404).end()
      return
    }
    uploads.push({ path: req.url!, headers: req.headers, body })
    if (req.url === '/held-upload') await new Promise((resolve) => setTimeout(resolve, 200))
    const retry = req.url === '/retry' && uploads.filter((u) => u.path === '/retry').length === 1
    res.writeHead(retry ? 503 : 204).end()
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture server port')
  origin = `http://127.0.0.1:${address.port}`
})

test.afterAll(async () => {
  if (!server) return
  server.closeAllConnections()
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

test.beforeEach(async ({ page }) => {
  uploads = []
  await page.goto(origin)
  await page.evaluate(() => {
    window.events = []
    window.sdkTest.RushRUM.init({
      endpoint: '/events',
      app: { name: 'browser-test' },
      trackWebVitals: false,
      trackErrors: false,
      trackPageViews: false,
      trackLongTasks: false,
      trackResources: true,
      propagateTraces: { origins: [/.*/] },
      beforeSend(event) {
        window.events.push(event)
        return event
      },
    })
  })
})

test('traced fetch(Request) preserves headers, body and method without mutating the caller', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const headers = new Headers({
      Authorization: 'Bearer test-only', 'X-CSRF-Token': 'test-csrf',
      'Content-Type': 'application/json', 'X-Custom': 'present',
    })
    const request = new Request(`${location.origin}/echo`, {
      method: 'POST', headers, body: '{"hello":"world"}', credentials: 'include',
    })
    const echoed = await (await fetch(request)).json()
    return {
      echoed, requestHeaders: [...request.headers], originalHeaders: [...headers],
      resource: window.events.find((event) => event.event_type === 'resource'),
    }
  })
  expect(result.echoed.headers).toMatchObject({
    authorization: 'Bearer test-only', 'x-csrf-token': 'test-csrf',
    'content-type': 'application/json', 'x-custom': 'present',
  })
  expect(result.echoed.headers.traceparent).toMatch(/^00-[a-f0-9]{32}-[a-f0-9]{16}-01$/)
  expect(result.echoed.method).toBe('POST')
  expect(result.echoed.body).toBe('{"hello":"world"}')
  expect(result.requestHeaders).toEqual(result.originalHeaders)
  expect(result.requestHeaders.some(([name]) => name === 'traceparent')).toBe(false)
  expect(JSON.parse(result.resource!.attributes!).method).toBe('POST')
})

test('explicit header overrides, empty overrides, string and URL inputs retain fetch semantics', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const request = new Request(`${location.origin}/echo`, { headers: { Authorization: 'original' } })
    const headers = new Headers({ 'X-Override': 'yes' })
    const overridden = await (await fetch(request, { headers, method: 'PATCH' })).json()
    const empty = await (await fetch(request, { headers: {} })).json()
    const string = await (await fetch('/echo', { headers: { 'X-String': 'yes' } })).json()
    const url = await (await fetch(new URL('/echo', location.href), { headers: { 'X-URL': 'yes' } })).json()
    return { overridden, empty, string, url, headers: [...headers] }
  })
  expect(result.overridden.headers.authorization).toBeUndefined()
  expect(result.overridden.headers['x-override']).toBe('yes')
  expect(result.overridden.method).toBe('PATCH')
  expect(result.empty.headers.authorization).toBeUndefined()
  expect(result.string.headers['x-string']).toBe('yes')
  expect(result.url.headers['x-url']).toBe('yes')
  for (const echoed of [result.overridden, result.empty, result.string, result.url]) {
    expect(echoed.headers.traceparent).toBeTruthy()
  }
  expect(result.headers).toEqual([['x-override', 'yes']])
})

test('event uploads, retries and old offline endpoints never generate resource events', async ({ page }) => {
  await page.evaluate(async () => {
    await fetch('/echo')
    window.sdkTest.RushRUM.flush()
    await window.sdkTest.sendBatch('/retry', '{}', false)
    localStorage.setItem('rush_rum_buf_v1', JSON.stringify([
      { url: '/old-events', body: '{}', ts: 1 },
    ]))
    await window.sdkTest.drainBuffer()
  })
  await expect.poll(() => uploads.filter((u) => u.path === '/events').length).toBe(1)
  expect(uploads.filter((u) => u.path === '/retry')).toHaveLength(2)
  expect(uploads.filter((u) => u.path === '/old-events')).toHaveLength(1)
  // Observe multiple 250 ms flush intervals so upload feedback loops are visible.
  await page.waitForTimeout(1_100)
  expect(uploads.filter((u) => u.path === '/events')).toHaveLength(1)
  expect(await page.evaluate(() => window.events.map((event) => event.event_name))).toEqual(['/echo'])
  expect(uploads.every((upload) => upload.headers.traceparent === undefined)).toBe(true)
})

test('application XHR is tracked while the SDK unload XHR is excluded', async ({ page }) => {
  const echoed = await page.evaluate(async () => {
    const result = await new Promise<any>((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      xhr.open('POST', '/echo')
      // Resource tracking runs on loadend, after the load handler.
      xhr.onload = () => setTimeout(() => resolve(JSON.parse(xhr.responseText)), 0)
      xhr.onerror = reject
      xhr.send('application body')
    })
    Object.defineProperty(navigator, 'sendBeacon', { configurable: true, value: undefined })
    window.dispatchEvent(new Event('pagehide'))
    return result
  })
  expect(echoed.headers.traceparent).toBeTruthy()
  expect(echoed.body).toBe('application body')
  expect(await page.evaluate(() => window.events.map((event) => event.event_name))).toEqual(['/echo'])
  expect(uploads).toHaveLength(1)
  expect(uploads[0].path).toBe('/events')
  expect(uploads[0].headers.traceparent).toBeUndefined()
})

test('real rrweb snapshots above 64 KiB reach a custom replay endpoint without upload feedback', async ({ page }) => {
  await page.evaluate(() => {
    window.sdkTest.RushRUM.destroy()
    const content = document.createElement('div')
    content.textContent = 'snapshot text '.repeat(10_000)
    document.body.append(content)
    window.sdkTest.RushRUM.init({
      endpoint: '/events', replayEndpoint: '/custom-replay', app: { name: 'replay-test' },
      trackResources: true, trackSessionReplay: true, trackPageViews: false,
      trackWebVitals: false, trackErrors: false, trackLongTasks: false,
      propagateTraces: { origins: [/.*/] },
      beforeSend(event) { window.events.push(event); return event },
    })
  })
  // The full snapshot must arrive immediately, before the five-second flush.
  await expect.poll(() => uploads.filter((u) => u.path === '/custom-replay').length, { timeout: 3_000 }).toBe(1)
  const upload = uploads.find((u) => u.path === '/custom-replay')!
  expect(Buffer.byteLength(upload.body)).toBeGreaterThan(65_536)
  expect(JSON.parse(upload.body).events.some((event: any) => event.type === 2)).toBe(true)
  expect(upload.headers.traceparent).toBeUndefined()
  await page.waitForTimeout(1_100)
  expect(await page.evaluate(() => window.events)).toEqual([])
  expect(uploads.filter((u) => u.path === '/events')).toHaveLength(0)
})

test('oversized UTF-8 unload bodies and rejected keepalive requests fall back to ordinary fetch', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { internalFetch } = window.sdkTest
    const keepaliveAttempts: boolean[] = []
    const originalFetch = window.fetch
    window.fetch = (input, init) => {
      if (input === '/quota-fallback') keepaliveAttempts.push(init?.keepalive === true)
      return originalFetch(input, init)
    }
    const large = await internalFetch('/large-final-chunk', {
      method: 'POST', body: 'é'.repeat(40_000), keepalive: true,
    })
    // Occupy Chromium's keepalive budget outside the SDK so its local byte
    // counter cannot predict the rejection of the next request.
    const blocker = fetch('/held-upload', {
      method: 'POST', body: 'x'.repeat(60_000), keepalive: true,
    })
    const fallback = await internalFetch('/quota-fallback', {
      method: 'POST', body: 'x'.repeat(20_000), keepalive: true,
    })
    await blocker
    return { statuses: [large.status, fallback.status], keepaliveAttempts }
  })
  expect(result.statuses).toEqual([204, 204])
  expect(result.keepaliveAttempts).toEqual([true, false])
  expect(Buffer.byteLength(uploads.find((u) => u.path === '/large-final-chunk')!.body)).toBe(80_000)
  expect(uploads.filter((u) => u.path === '/quota-fallback')).toHaveLength(1)
})
