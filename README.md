# @rushobservability/rum-sdk

Real User Monitoring (RUM) browser SDK for [Rush Observability](https://github.com/RushObservability). Lightweight, dependency-light, and framework-agnostic — it captures Web Vitals, JS errors, page views, interactions, resource timing, and optional session replay, then ships them to your Rush ingest endpoint.

## Install

```bash
npm install @rushobservability/rum-sdk
```

## Usage

```ts
import RushRUM from '@rushobservability/rum-sdk'

RushRUM.init({
  endpoint: 'https://your-rush-host/rum/ingest',
  app: { name: 'my-web-app', version: '1.4.2' },
  environment: 'production',

  // What to collect (defaults shown)
  trackWebVitals: true,     // LCP, INP, CLS, FCP, TTFB (via web-vitals)
  trackErrors: true,        // uncaught errors + unhandled rejections
  trackPageViews: true,     // SPA-aware page views
  trackLongTasks: true,     // long tasks + Long Animation Frames (LoAF)
  trackInteractions: false, // click/input + frustration signals
  trackResources: false,    // resource timing entries
  trackSessionReplay: false,// DOM session replay (via rrweb)

  // Optional
  sampleRate: 1.0,                       // 0..1
  user: () => ({ id: currentUserId }),   // attach a user id
  propagateTraces: { origins: [/^https:\/\/api\.example\.com/] },

  // Replay privacy (default 'mask' — masks ALL text + inputs, blocks media)
  replayPrivacy: 'mask',

  // Mutate/drop events before they're queued (return null to drop)
  beforeSend: (event) => event,
})

// Custom events
RushRUM.trackEvent('checkout_completed', { plan: 'pro', amount: 49 })

// Dynamically set/override the current user (overrides config.user)
RushRUM.setUser({ id: 'user-123' })
RushRUM.setUser(null) // clear

// Attributes merged into every event's `attributes` (event keys win)
RushRUM.setGlobalAttributes({ tenant: 'acme', release: 'canary' })
RushRUM.clearGlobalAttributes()

// Flush the queue manually (e.g. before a hard navigation)
RushRUM.flush()

// Stop collecting + detach handlers/timers (tests, SPA hot-reload)
RushRUM.destroy()
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
| `trackLongTasks` | `boolean` | `true` | Long tasks (>50ms) + Long Animation Frames (LoAF), via `PerformanceObserver` |
| `trackInteractions` | `boolean` | `false` | Click/input events + frustration signals (rage/dead/error clicks) |
| `trackResources` | `boolean` | `false` | Resource timing |
| `trackSessionReplay` | `boolean` | `false` | DOM session replay (rrweb) |
| `propagateTraces` | `{ origins: RegExp[] }` | — | Inject trace headers on matching XHR/fetch origins |
| `replayEndpoint` | `string` | `<endpoint>/rum/replay/ingest` | Override the replay ingest URL |
| `captureQueryParams` | `boolean` | `false` | Keep query strings + hash on captured URLs. Off by default — query params often carry tokens/PII |
| `maskInteractionText` | `boolean` | `false` | Drop clicked-element text from interaction events (keep only tag/id/classes) |
| `compress` | `boolean` | `false` | gzip the request body (`Content-Encoding: gzip`) via `CompressionStream`. **Only enable if your ingest endpoint decodes gzip — the current Rush backend does not.** The unload/beacon path is always uncompressed |
| `beforeSend` | `(event) => RumEvent \| null` | — | Mutate or drop each event before it's queued (return `null` to drop). A throwing hook never breaks collection |
| `replayPrivacy` | `'mask' \| 'mask-user-input' \| 'allow'` | `'mask'` | Replay masking level (see below) |
| `replayMaskSelector` | `string` | — | Extra CSS selector for text/elements to mask in replay (merged with `[data-pii]`) |
| `replayBlockSelector` | `string` | — | Extra CSS selector for elements to block (not record) in replay |
| `replayUnmaskSelector` | `string` | — | Extra CSS selector for text to leave un-masked in replay (only applies when text masking is on) |
| `replayBeforeAddEvent` | `(event) => unknown \| null` | — | Scrub or drop replay events before buffering (return `null` to drop) |

### Methods

| Method | Description |
|---|---|
| `RushRUM.init(config)` | Initialize and start collection (SSR-safe no-op; ignores duplicate calls) |
| `RushRUM.trackEvent(name, attributes?)` | Send a custom event |
| `RushRUM.setUser(user \| null)` | Dynamically set/override the user id (overrides `config.user`); `null` clears |
| `RushRUM.setGlobalAttributes(attrs)` | Merge attributes into every subsequent event's `attributes` (event-specific keys win) |
| `RushRUM.clearGlobalAttributes()` | Clear all global attributes |
| `RushRUM.flush()` | Force-flush the queue |
| `RushRUM.destroy()` | Stop collection; detach all observers/timers/listeners |

### Replay privacy

**As of 0.2.0, session replay is private by default** — a behavior change from 0.1.x, which masked inputs but recorded all visible text. The `replayPrivacy` level maps to rrweb options:

| Level | Inputs | Text | Media |
|---|---|---|---|
| `'mask'` (default) | masked | **all text masked** | `img,video,audio,picture,source,canvas` blocked |
| `'mask-user-input'` | masked | visible | recorded |
| `'allow'` | recorded | visible | recorded |

`[data-pii]` is **always** masked regardless of level. `replayMaskSelector` / `replayBlockSelector` add more, and `replayUnmaskSelector` carves out exceptions when text masking is on.

### Reliability

Event batches are sent through a hardened transport: failed sends (network error, HTTP 429/5xx) are retried up to 3× with exponential backoff + jitter. Batches that still fail — or any sent while `navigator.onLine === false` — are persisted to `localStorage` (versioned key, ~1 MB / 50-batch cap, oldest dropped on overflow) and drained oldest-first on the next `init()` and whenever the `online` event fires. The in-memory queue is capped at 1000 events (oldest dropped). The unload/beacon path uses `sendBeacon` (uncompressed, no retry). All of this is best-effort and never throws into your app.

### Frustration signals

When `trackInteractions` is enabled, the SDK emits `frustration` events:

- **rage_click** — more than 3 clicks on the same element within 1s.
- **dead_click** — a click on an interactive element that produces no DOM mutation, URL change, or scroll within 3s (conservative, to avoid false positives).
- **error_click** — a JS error fires within 1s of a click.

`sampleRate` is decided **once per session** and applied to every event, so sampled sessions are complete (no half-captured sessions).

`init()` is a no-op outside the browser (SSR-safe) and ignores duplicate calls. `RushRUM.destroy()` stops collection and detaches handlers/timers (useful for tests / SPA hot-reload).

## Build

```bash
npm install
npm run build      # tsc → dist/
npm run typecheck  # type-check only
```

## License

[MIT](LICENSE)
