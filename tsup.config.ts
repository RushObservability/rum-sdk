import { defineConfig } from 'tsup'

// Two builds from a single entry:
//
//  1. ESM (npm / bundler consumers): dist/index.js + dist/index.d.ts.
//     rrweb AND web-vitals stay external — they're dynamically imported and the
//     consumer's bundler resolves them (rrweb is optional; web-vitals a dep).
//
//  2. IIFE (CDN / <script>): dist/rush-rum.global.js exposing a `RushRUM` global.
//     web-vitals is bundled. NOTE: a classic-script IIFE has no module loader, so
//     esbuild CANNOT keep the dynamic import('rrweb') external — rrweb is inlined
//     and the CDN bundle is self-contained INCLUDING session replay (~290KB raw /
//     ~80KB gzip). The `external: ['rrweb']` below is thus effectively a no-op for
//     the IIFE. The ESM build (1) does externalize rrweb, so npm/bundler consumers
//     stay lean (~15KB) and pull rrweb only if they enable replay.
//     (Follow-up for a lean CDN core: ship a separate replay-less IIFE entry.)
export default defineConfig([
  {
    entry: { index: 'src/index.ts' },
    format: ['esm'],
    target: 'es2020',
    dts: true,
    sourcemap: true,
    minify: true,
    treeshake: true,
    clean: true,
    external: ['rrweb', 'web-vitals'],
  },
  {
    // tsup appends `.global.js` for the IIFE format, so the entry key is
    // `rush-rum` → output dist/rush-rum.global.js (matches unpkg/jsdelivr).
    // Built from global.ts (default-export only) so the `RushRUM` global is the
    // SDK object itself, not `{ RushRUM, default }`.
    entry: { 'rush-rum': 'src/global.ts' },
    format: ['iife'],
    globalName: 'RushRUM',
    target: 'es2020',
    dts: false,
    sourcemap: true,
    minify: true,
    treeshake: true,
    // Bundle web-vitals into the CDN build; keep rrweb external (see header).
    external: ['rrweb'],
    // Don't wipe the ESM build's output (it ran first with clean: true).
    clean: false,
  },
])
