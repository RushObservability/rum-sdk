import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { detectBrowser } from '../src/browser'

function withUA(ua: string) {
  Object.defineProperty(navigator, 'userAgent', { value: ua, configurable: true })
}

const originalUA = navigator.userAgent

beforeEach(() => {
  // happy-dom exposes window.screen; ensure deterministic dimensions.
  Object.defineProperty(window.screen, 'width', { value: 1920, configurable: true })
  Object.defineProperty(window.screen, 'height', { value: 1080, configurable: true })
})

afterEach(() => {
  withUA(originalUA)
  vi.restoreAllMocks()
})

describe('detectBrowser UA parsing', () => {
  it('detects Chrome on Windows (desktop)', () => {
    withUA(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    )
    const info = detectBrowser()
    expect(info.browserName).toBe('Chrome')
    expect(info.browserVersion).toBe('124.0.0.0')
    expect(info.osName).toBe('Windows')
    expect(info.osVersion).toBe('10.0')
    expect(info.deviceType).toBe('desktop')
    expect(info.screenWidth).toBe(1920)
    expect(info.screenHeight).toBe(1080)
  })

  it('detects Firefox on Linux', () => {
    withUA('Mozilla/5.0 (X11; Linux x86_64; rv:125.0) Gecko/20100101 Firefox/125.0')
    const info = detectBrowser()
    expect(info.browserName).toBe('Firefox')
    expect(info.browserVersion).toBe('125.0')
    expect(info.osName).toBe('Linux')
    expect(info.deviceType).toBe('desktop')
  })

  it('detects Safari on macOS', () => {
    withUA(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
    )
    const info = detectBrowser()
    expect(info.browserName).toBe('Safari')
    expect(info.browserVersion).toBe('17.4')
    expect(info.osName).toBe('macOS')
    expect(info.osVersion).toBe('10.15.7')
    expect(info.deviceType).toBe('desktop')
  })

  it('detects Edge (Edg/ wins over Chrome/)', () => {
    withUA(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0',
    )
    const info = detectBrowser()
    expect(info.browserName).toBe('Edge')
    expect(info.browserVersion).toBe('124.0.0.0')
  })

  it('detects mobile device on Android Chrome', () => {
    withUA(
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
    )
    const info = detectBrowser()
    expect(info.browserName).toBe('Chrome')
    expect(info.deviceType).toBe('mobile')
    // Android is checked before Linux (the UA also contains "Linux").
    expect(info.osName).toBe('Android')
    expect(info.osVersion).toBe('14')
  })

  it('detects tablet on iPad', () => {
    withUA(
      'Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
    )
    const info = detectBrowser()
    expect(info.deviceType).toBe('tablet')
    // iPhone/iPad/iPod is checked before "Mac OS X" (which the iOS UA contains).
    expect(info.osName).toBe('iOS')
  })

  it('detects mobile + iOS on iPhone', () => {
    withUA(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
    )
    const info = detectBrowser()
    expect(info.deviceType).toBe('mobile')
    expect(info.osName).toBe('iOS')
    expect(info.osVersion).toBe('17.4')
  })

  it('falls back to Unknown for an unrecognized UA', () => {
    withUA('SomeRandomBot/1.0')
    const info = detectBrowser()
    expect(info.browserName).toBe('Unknown')
    expect(info.osName).toBe('Unknown')
    expect(info.deviceType).toBe('desktop')
  })
})
