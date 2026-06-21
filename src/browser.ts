export interface BrowserInfo {
  browserName: string
  browserVersion: string
  osName: string
  osVersion: string
  deviceType: 'desktop' | 'mobile' | 'tablet'
  screenWidth: number
  screenHeight: number
}

export function detectBrowser(): BrowserInfo {
  const ua = navigator.userAgent

  let browserName = 'Unknown'
  let browserVersion = ''

  if (ua.includes('Firefox/')) {
    browserName = 'Firefox'
    browserVersion = ua.split('Firefox/')[1]?.split(' ')[0] ?? ''
  } else if (ua.includes('Edg/')) {
    browserName = 'Edge'
    browserVersion = ua.split('Edg/')[1]?.split(' ')[0] ?? ''
  } else if (ua.includes('Chrome/')) {
    browserName = 'Chrome'
    browserVersion = ua.split('Chrome/')[1]?.split(' ')[0] ?? ''
  } else if (ua.includes('Safari/') && !ua.includes('Chrome')) {
    browserName = 'Safari'
    browserVersion = ua.split('Version/')[1]?.split(' ')[0] ?? ''
  }

  let osName = 'Unknown'
  let osVersion = ''
  // Order matters: Android UAs contain "Linux" and iOS UAs contain "Mac OS X",
  // so the mobile OSes must be checked BEFORE Linux/macOS.
  if (ua.includes('Windows')) {
    osName = 'Windows'
    const m = ua.match(/Windows NT (\d+\.\d+)/)
    osVersion = m?.[1] ?? ''
  } else if (ua.includes('Android')) {
    osName = 'Android'
    const m = ua.match(/Android (\d+(\.\d+)?)/)
    osVersion = m?.[1] ?? ''
  } else if (/iPhone|iPad|iPod/.test(ua)) {
    osName = 'iOS'
    const m = ua.match(/OS (\d+_\d+)/)
    osVersion = m?.[1]?.replace('_', '.') ?? ''
  } else if (ua.includes('Mac OS X')) {
    osName = 'macOS'
    const m = ua.match(/Mac OS X (\d+[._]\d+[._]?\d*)/)
    osVersion = m?.[1]?.replace(/_/g, '.') ?? ''
  } else if (ua.includes('Linux')) {
    osName = 'Linux'
  }

  let deviceType: 'desktop' | 'mobile' | 'tablet' = 'desktop'
  if (/Mobi|Android.*Mobile/.test(ua)) {
    deviceType = 'mobile'
  } else if (/iPad|Android(?!.*Mobile)|Tablet/.test(ua)) {
    deviceType = 'tablet'
  }

  return {
    browserName,
    browserVersion,
    osName,
    osVersion,
    deviceType,
    screenWidth: window.screen.width,
    screenHeight: window.screen.height,
  }
}
