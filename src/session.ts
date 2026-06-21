const SESSION_KEY = 'rush_rum_sid'
const SESSION_TS_KEY = 'rush_rum_sts'
const TIMEOUT_MS = 30 * 60 * 1000 // 30 minutes

function generateId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

export function getSessionId(): string {
  try {
    const stored = sessionStorage.getItem(SESSION_KEY)
    const ts = sessionStorage.getItem(SESSION_TS_KEY)
    const now = Date.now()

    if (stored && ts && now - Number(ts) < TIMEOUT_MS) {
      sessionStorage.setItem(SESSION_TS_KEY, String(now))
      return stored
    }

    const id = generateId()
    sessionStorage.setItem(SESSION_KEY, id)
    sessionStorage.setItem(SESSION_TS_KEY, String(now))
    return id
  } catch {
    // sessionStorage not available (e.g. incognito overflow)
    return generateId()
  }
}

export function touchSession(): void {
  try {
    sessionStorage.setItem(SESSION_TS_KEY, String(Date.now()))
  } catch { /* ignore */ }
}
