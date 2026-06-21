# @rush/rum

Real User Monitoring (RUM) browser SDK for [Rush Observability](https://github.com/RushObservability). Lightweight, dependency-light, and framework-agnostic — it captures Web Vitals, JS errors, page views, interactions, resource timing, and optional session replay, then ships them to your Rush ingest endpoint.

## Install

```bash
npm install @rush/rum
```

## Usage

```ts
import RushRUM from '@rush/rum'

RushRUM.init({
  endpoint: 'https://your-rush-host/rum/ingest',
  app: { name: 'my-web-app', version: '1.4.2' },
  environment: 'production',

  // What to collect (defaults shown)
  trackWebVitals: true,     // LCP, INP, CLS, FCP, TTFB (via web-vitals)
  trackErrors: true,        // uncaught errors + unhandled rejections
  trackPageViews: true,     // SPA-aware page views
  trackInteractions: false, // click/input interaction events
  trackResources: false,    // resource timing entries
  trackSessionReplay: false,// DOM session replay (via rrweb)

  // Optional
  sampleRate: 1.0,                       // 0..1
  user: () => ({ id: currentUserId }),   // attach a user id
  propagateTraces: { origins: [/^https:\/\/api\.example\.com/] },
})

// Custom events
RushRUM.trackEvent('checkout_completed', { plan: 'pro', amount: 49 })

// Flush the queue manually (e.g. before a hard navigation)
RushRUM.flush()
```

### Configuration

| Option | Type | Default | Description |
|---|---|---|---|
| `endpoint` | `string` | — (required) | Rush RUM ingest URL |
| `app` | `{ name, version? }` | — (required) | Application identity |
| `environment` | `string` | — | e.g. `production`, `staging` |
| `sampleRate` | `number` | `1.0` | Fraction of sessions to record (0–1) |
| `user` | `() => { id? } \| null` | — | Resolver for the current user id |
| `trackWebVitals` | `boolean` | `true` | Core Web Vitals |
| `trackErrors` | `boolean` | `true` | Uncaught errors + promise rejections |
| `trackPageViews` | `boolean` | `true` | SPA-aware page views |
| `trackInteractions` | `boolean` | `false` | Click/input events |
| `trackResources` | `boolean` | `false` | Resource timing |
| `trackSessionReplay` | `boolean` | `false` | DOM session replay (rrweb) |
| `propagateTraces` | `{ origins: RegExp[] }` | — | Inject trace headers on matching XHR/fetch origins |
| `replayEndpoint` | `string` | `<endpoint>/rum/replay/ingest` | Override the replay ingest URL |

## Build

```bash
npm install
npm run build      # tsc → dist/
npm run typecheck  # type-check only
```

## License

[MIT](LICENSE)
