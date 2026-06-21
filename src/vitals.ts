import { pushEvent } from './core'

export function initVitals(): void {
  // Dynamic import so the SDK works even if web-vitals isn't available
  import('web-vitals').then(({ onLCP, onCLS, onINP, onFCP, onTTFB }) => {
    const report = (name: string) => (metric: { value: number; rating: string }) => {
      pushEvent({
        event_type: 'web_vital',
        vital_name: name,
        vital_value: metric.value,
        vital_rating: metric.rating,
      })
    }

    onLCP(report('LCP'))
    onCLS(report('CLS'))
    onINP(report('INP'))
    onFCP(report('FCP'))
    onTTFB(report('TTFB'))
  }).catch(() => {
    // web-vitals not available — skip
  })
}
