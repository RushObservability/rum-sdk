/**
 * Tiny shared module for the "error click" frustration signal. interactions.ts
 * records the last click here; errors.ts reads it when a JS error fires. Living
 * in its own module avoids a circular import between those two files.
 */

export interface LastClick {
  /** A descriptor of the clicked element (same format as interaction events). */
  target: string
  /** Click time, ms via performance.now() / Date.now() fallback. */
  ts: number
}

let lastClick: LastClick | null = null

function now(): number {
  return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()
}

export function recordClick(target: string): void {
  lastClick = { target, ts: now() }
}

export function getLastClick(): LastClick | null {
  return lastClick
}

export function clearLastClick(): void {
  lastClick = null
}
