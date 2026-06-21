# Changelog

## 0.2.0

### Reliability (P1)
- **Transport hardening**: event batches now retry on network error / HTTP 429 / 5xx up to 3× with exponential backoff + jitter, then fall back to an offline buffer persisted in `localStorage` (versioned key, ~1 MB / 50-batch cap, oldest dropped on overflow). Buffered batches drain oldest-first on `init()` and on the `online` event. The in-memory queue is capped at 1000 events (oldest dropped). Best-effort throughout — never throws into the host app.
- **Optional gzip compression** (`compress`, default off): when enabled and `CompressionStream` is available, the request body is gzipped with `Content-Encoding: gzip`. Off by default because the current Rush backend does not decode gzip; the unload/beacon path is always uncompressed.
- **`beforeSend` hook**: mutate or drop each event before it is queued (return `null` to drop). A throwing hook never breaks collection.
- **Dynamic user + global attributes**: `RushRUM.setUser()` overrides `config.user`; `RushRUM.setGlobalAttributes()` / `clearGlobalAttributes()` merge attributes into every event's `attributes` JSON (event-specific keys win).

### Replay privacy (P1) — **behavior change**
- **Session replay is now private by default.** `replayPrivacy` defaults to `'mask'`, which masks all inputs, masks all visible text, and blocks media (`img,video,audio,picture,source,canvas`). Previously (0.1.x) only inputs were masked and all text was recorded. Use `'mask-user-input'` or `'allow'` to loosen.
- New selectors: `replayMaskSelector`, `replayBlockSelector`, `replayUnmaskSelector` (merged with the always-on `[data-pii]` mask).
- New `replayBeforeAddEvent` hook to scrub/drop replay events before buffering.
- The recorder is now idempotent and fully torn down by `destroy()` (stops rrweb, clears the flush timer, removes listeners).

### Instrumentation (P2)
- **Long tasks + LoAF** (`trackLongTasks`, default **on**): `PerformanceObserver` emits `long_task` events and, where supported, `loaf` (Long Animation Frame) events.
- **Frustration signals** (with `trackInteractions`): emits `frustration` events for `rage_click` (>3 clicks on one element within 1s), `dead_click` (no DOM/URL/scroll change within 3s), and `error_click` (a JS error within 1s of a click).

### Packaging (P3)
- **tsup dual build**: minified ESM (`dist/index.js`, rrweb/web-vitals external) + a `<script>`/CDN IIFE (`dist/rush-rum.global.js`, global `RushRUM`); `unpkg`/`jsdelivr` point at the IIFE; `sideEffects: false`.
- **`rrweb` is now an `optionalDependency`** (web-vitals stays a dependency). Vitest suite + CI; the publish workflow is gated on `typecheck` + `test`.
- **Lean CDN core**: the IIFE is built from a replay-less entry, so rrweb (~200KB) is **not** in the CDN bundle. Session replay over a `<script>` drop-in is unsupported — use the npm/ESM package for replay.

### Fixes
- **OS detection**: iPhone/iPad now report `iOS` and Android reports `Android` (previously `macOS`/`Linux`, because those substrings appear in the mobile UA strings and were matched first).

### Notes
- Wire format is unchanged and backward-compatible: only new optional config, new methods, and new `event_type` values (`long_task`, `loaf`, `frustration`) carried in existing fields. `RumEvent.timestamp` remains a numeric (ns) value.
- `destroy()` now tears down every new observer, timer, and listener.
