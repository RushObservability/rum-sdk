import { pushEvent, getConfig } from './core'

const INTERACTIVE_SELECTORS = 'button, a, [role="button"], input[type="submit"], input[type="button"]'

let bound = false

export function initInteractions(): void {
  if (bound) return // single global click listener
  bound = true

  document.addEventListener('click', (event: MouseEvent) => {
    const target = event.target as Element | null
    if (!target) return

    const interactive = target.closest(INTERACTIVE_SELECTORS)
    if (!interactive) return

    const tag = interactive.tagName.toLowerCase()
    const id = interactive.id ? `#${interactive.id}` : ''
    const classes = interactive.className
      ? `.${Array.from(interactive.classList).slice(0, 3).join('.')}`
      : ''
    // Element text can carry PII (names, amounts) — omit it when masked.
    const text = getConfig()?.maskInteractionText
      ? ''
      : (interactive.textContent ?? '').trim().slice(0, 100)

    pushEvent({
      event_type: 'interaction',
      interaction_type: 'click',
      interaction_target: `${tag}${id}${classes}${text ? ` "${text}"` : ''}`,
    })
  }, { capture: true, passive: true })
}
