import { pushEvent } from './core'
import { getLastClick } from './frustration'

// Error click: a JS error within this window of the last click is treated as a
// frustration signal (the click likely triggered the error).
const ERROR_CLICK_WINDOW_MS = 1_000

let bound = false
let onError: ((event: ErrorEvent) => void) | null = null
let onRejection: ((event: PromiseRejectionEvent) => void) | null = null

/** Emit an error_click frustration event if a recent click preceded this error. */
function maybeEmitErrorClick(): void {
  const last = getLastClick()
  if (!last) return
  const now =
    typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()
  if (now - last.ts < ERROR_CLICK_WINDOW_MS) {
    pushEvent({
      event_type: 'frustration',
      interaction_type: 'error_click',
      interaction_target: last.target,
    })
  }
}

export function initErrors(): void {
  if (bound) return // single set of error listeners per init
  bound = true

  onError = (event: ErrorEvent): void => {
    maybeEmitErrorClick()
    pushEvent({
      event_type: 'error',
      error_message: event.message || 'Unknown error',
      error_stack: event.error?.stack ?? '',
      error_type: event.error?.name ?? 'Error',
    })
  }

  onRejection = (event: PromiseRejectionEvent): void => {
    const reason = event.reason
    let message = 'Unhandled promise rejection'
    let stack = ''
    let errorType = 'UnhandledRejection'

    if (reason instanceof Error) {
      message = reason.message
      stack = reason.stack ?? ''
      errorType = reason.name
    } else if (typeof reason === 'string') {
      message = reason
    }

    pushEvent({
      event_type: 'error',
      error_message: message,
      error_stack: stack,
      error_type: errorType,
    })
  }

  window.addEventListener('error', onError)
  window.addEventListener('unhandledrejection', onRejection)
}

/** Detach the error/rejection listeners. */
export function destroyErrors(): void {
  if (onError) {
    window.removeEventListener('error', onError)
    onError = null
  }
  if (onRejection) {
    window.removeEventListener('unhandledrejection', onRejection)
    onRejection = null
  }
  bound = false
}
