import { pushEvent } from './core'

export function initErrors(): void {
  window.addEventListener('error', (event: ErrorEvent) => {
    pushEvent({
      event_type: 'error',
      error_message: event.message || 'Unknown error',
      error_stack: event.error?.stack ?? '',
      error_type: event.error?.name ?? 'Error',
    })
  })

  window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
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
  })
}
