// CDN / <script> entry point.
//
// The IIFE build sets `globalName: 'RushRUM'`. If we built it from index.ts —
// which has BOTH `export const RushRUM` and `export default RushRUM` — esbuild
// would expose `window.RushRUM = { RushRUM, default }`, forcing consumers to
// write `RushRUM.default.init(...)`. By re-exporting ONLY a default here, the
// global becomes the RushRUM object itself, so `RushRUM.init(...)` works.
import RushRUM from './index'

export default RushRUM
