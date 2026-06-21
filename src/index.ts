import { makeRushRUM } from './bootstrap'
import { initReplay, destroyReplay } from './replay'

export type { RushRUMConfig, RumEvent, RumPayload } from './types'

// Full npm build: session replay (rrweb) is wired in. Bundler consumers pull
// rrweb only when they enable trackSessionReplay (it's a dynamic import behind
// an optionalDependency).
export const RushRUM = makeRushRUM({ init: initReplay, destroy: destroyReplay })

export default RushRUM
