import { defineConfig } from 'tsup'

// Two builds from a single entry:
//
//  1. ESM (npm / bundler consumers): dist/index.js + dist/index.d.ts.
//     rrweb AND web-vitals stay external — they're dynamically imported and the
//     consumer's bundler resolves them (rrweb is optional; web-vitals a dep).
//
//  2. IIFE (CDN / <script>): dist/rush-rum.global.js exposing a `RushRUM` global.
//     Built from global.ts (LEAN core) which uses makeRushRUM() WITHOUT the replay
//     module, so replay.ts — and therefore rrweb — is never in this bundle's
//     import graph. The CDN file stays small (no ~200KB rrweb). web-vitals IS
//     bundled (tiny) so Web Vitals work standalone. Session replay over a <script>
//     drop-in is intentionally unsupported here; use the npm/ESM package for replay.
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
