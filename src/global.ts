// CDN / <script> entry point — LEAN core (no session replay).
//
// Built into the IIFE `dist/rush-rum.global.js` with `globalName: 'RushRUM'`.
// It uses makeRushRUM() WITHOUT the replay module, so replay.ts (and therefore
// rrweb, ~200KB) is never in this bundle's import graph — keeping the CDN file
// small. Calling init({ trackSessionReplay: true }) here logs a warning; session
// replay requires the npm/ESM package (@rushobservability/rum-sdk).
//
// A default-only export keeps the global the RushRUM object itself
// (`RushRUM.init(...)`), not `{ RushRUM, default }`.
import { makeRushRUM } from './bootstrap'

export default makeRushRUM()
