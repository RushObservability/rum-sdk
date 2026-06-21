const SESSION_KEY = 'rush_rum_sid'
const SESSION_TS_KEY = 'rush_rum_sts'
const SESSION_SAMPLED_KEY = 'rush_rum_smp'
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
    // New logical session → re-decide sampling next time it's asked.
    sessionStorage.removeItem(SESSION_SAMPLED_KEY)
    return id
  } catch {
    // sessionStorage not available (e.g. incognito overflow)
    return generateId()
  }
}

/**
 * Decide whether THIS session is sampled — once per session, cached so every
 * event in the session shares the same decision. Returns true if it should be
 * recorded. Cleared whenever a new session id is minted (see getSessionId).
 */
export function isSessionSampled(sampleRate: number): boolean {
  if (sampleRate >= 1) return true
  if (sampleRate <= 0) return false
  try {
    // Ensure a session id exists first, so a fresh session clears any stale flag.
    getSessionId()
    const stored = sessionStorage.getItem(SESSION_SAMPLED_KEY)
    if (stored !== null) return stored === '1'
    const sampled = Math.random() < sampleRate
    sessionStorage.setItem(SESSION_SAMPLED_KEY, sampled ? '1' : '0')
    return sampled
  } catch {
    // No sessionStorage → fall back to a per-load decision.
    return Math.random() < sampleRate
  }
}

export function touchSession(): void {
  try {
    sessionStorage.setItem(SESSION_TS_KEY, String(Date.now()))
  } catch { /* ignore */ }
}
