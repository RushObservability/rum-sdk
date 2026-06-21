import { pushEvent, getConfig } from './core'
import { recordClick } from './frustration'

const INTERACTIVE_SELECTORS = 'button, a, [role="button"], input[type="submit"], input[type="button"]'

// Rage click: >3 clicks on the SAME element within this sliding window.
const RAGE_WINDOW_MS = 1_000
const RAGE_THRESHOLD = 3
// Dead click: a click on an interactive element that causes no page change
// within this window (no DOM mutation, URL change, or scroll).
const DEAD_WINDOW_MS = 3_000

let bound = false
let clickListener: ((event: MouseEvent) => void) | null = null

// Rage-click sliding window per element.
let rageTarget: Element | null = null
let rageTimes: number[] = []

// Active dead-click watchers we may need to clean up on destroy().
interface DeadWatcher {
  observer: MutationObserver
  timer: ReturnType<typeof setTimeout>
  onScroll: () => void
}
let deadWatchers: DeadWatcher[] = []

/** Build the same target descriptor used for click interaction events. */
function describeTarget(el: Element): string {
  const tag = el.tagName.toLowerCase()
  const id = el.id ? `#${el.id}` : ''
  const classes = el.className
    ? `.${Array.from(el.classList).slice(0, 3).join('.')}`
    : ''
  // Element text can carry PII (names, amounts) — omit it when masked.
  const text = getConfig()?.maskInteractionText
    ? ''
    : (el.textContent ?? '').trim().slice(0, 100)
  return `${tag}${id}${classes}${text ? ` "${text}"` : ''}`
}

/** Detect a rage click; emits one frustration event when the threshold trips. */
function detectRageClick(el: Element, target: string): void {
  const now = Date.now()
  if (rageTarget !== el) {
    rageTarget = el
    rageTimes = []
  }
  rageTimes.push(now)
  // Keep only clicks within the sliding window.
  rageTimes = rageTimes.filter((t) => now - t <= RAGE_WINDOW_MS)
  if (rageTimes.length > RAGE_THRESHOLD) {
    pushEvent({
      event_type: 'frustration',
      interaction_type: 'rage_click',
      interaction_target: target,
    })
    // Reset so we emit at most once per burst.
    rageTimes = []
    rageTarget = null
  }
}

/**
 * Detect a dead click: watch for ANY DOM mutation, URL change, or scroll within
 * a short window after the click. If none happens, the click did nothing →
 * emit a dead_click frustration event. Conservative on purpose to avoid false
 * positives. The MutationObserver is one-shot and always disconnected.
 */
function detectDeadClick(target: string): void {
  let changed = false
  const startUrl = location.href

  const observer = new MutationObserver(() => {
    changed = true
  })
  try {
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
    })
  } catch {
    return
  }

  const onScroll = () => {
    changed = true
  }
  window.addEventListener('scroll', onScroll, { passive: true, capture: true })

  const timer = setTimeout(() => {
    cleanup()
    const navigated = location.href !== startUrl
    if (!changed && !navigated) {
      pushEvent({
        event_type: 'frustration',
        interaction_type: 'dead_click',
        interaction_target: target,
      })
    }
  }, DEAD_WINDOW_MS)

  const watcher: DeadWatcher = { observer, timer, onScroll }
  deadWatchers.push(watcher)

  function cleanup(): void {
    observer.disconnect()
    clearTimeout(timer)
    window.removeEventListener('scroll', onScroll, { capture: true } as EventListenerOptions)
    deadWatchers = deadWatchers.filter((w) => w !== watcher)
  }
}

export function initInteractions(): void {
  if (bound) return // single global click listener
  bound = true

  clickListener = (event: MouseEvent): void => {
    const target = event.target as Element | null
    if (!target) return

    const interactive = target.closest(INTERACTIVE_SELECTORS)
    if (!interactive) return

    const descriptor = describeTarget(interactive)

    // Record for the error-click signal (errors.ts reads this).
    recordClick(descriptor)

    pushEvent({
      event_type: 'interaction',
      interaction_type: 'click',
      interaction_target: descriptor,
    })

    detectRageClick(interactive, descriptor)
    detectDeadClick(descriptor)
  }

  document.addEventListener('click', clickListener, { capture: true, passive: true })
}

/** Detach the click listener and tear down any in-flight dead-click watchers. */
export function destroyInteractions(): void {
  if (clickListener) {
    document.removeEventListener('click', clickListener, { capture: true } as EventListenerOptions)
    clickListener = null
  }
  for (const w of deadWatchers) {
    w.observer.disconnect()
    clearTimeout(w.timer)
    window.removeEventListener('scroll', w.onScroll, { capture: true } as EventListenerOptions)
  }
  deadWatchers = []
  rageTarget = null
  rageTimes = []
  bound = false
}
