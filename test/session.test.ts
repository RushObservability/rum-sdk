import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getSessionId, isSessionSampled, touchSession } from '../src/session'

const SESSION_KEY = 'rush_rum_sid'
const SESSION_TS_KEY = 'rush_rum_sts'
const SESSION_SAMPLED_KEY = 'rush_rum_smp'
const TIMEOUT_MS = 30 * 60 * 1000

beforeEach(() => {
  sessionStorage.clear()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('getSessionId', () => {
  it('mints a new id when none stored', () => {
    expect(sessionStorage.getItem(SESSION_KEY)).toBeNull()
    const id = getSessionId()
    expect(id).toBeTruthy()
    expect(sessionStorage.getItem(SESSION_KEY)).toBe(id)
    expect(sessionStorage.getItem(SESSION_TS_KEY)).toBeTruthy()
  })

  it('reuses the id within the timeout window', () => {
    const first = getSessionId()
    const second = getSessionId()
    expect(second).toBe(first)
  })

  it('mints a new id when the stored session has expired', () => {
    const first = getSessionId()
    // Force the stored timestamp past the timeout.
    sessionStorage.setItem(SESSION_TS_KEY, String(Date.now() - TIMEOUT_MS - 1))
    const second = getSessionId()
    expect(second).not.toBe(first)
  })

  it('clears a stale sampled flag when a new session is minted', () => {
    getSessionId()
    sessionStorage.setItem(SESSION_SAMPLED_KEY, '1')
    // Expire it → new id → flag removed.
    sessionStorage.setItem(SESSION_TS_KEY, String(Date.now() - TIMEOUT_MS - 1))
    getSessionId()
    expect(sessionStorage.getItem(SESSION_SAMPLED_KEY)).toBeNull()
  })
})

describe('isSessionSampled', () => {
  it('returns true for sampleRate >= 1 without touching storage decision', () => {
    expect(isSessionSampled(1)).toBe(true)
    expect(isSessionSampled(2)).toBe(true)
    // No cached decision is written for the >=1 fast path.
    expect(sessionStorage.getItem(SESSION_SAMPLED_KEY)).toBeNull()
  })

  it('returns false for sampleRate <= 0', () => {
    expect(isSessionSampled(0)).toBe(false)
    expect(isSessionSampled(-1)).toBe(false)
  })

  it('decides once and caches the decision for the session', () => {
    const rand = vi.spyOn(Math, 'random').mockReturnValue(0.1) // 0.1 < 0.5 → sampled
    const first = isSessionSampled(0.5)
    expect(first).toBe(true)
    expect(sessionStorage.getItem(SESSION_SAMPLED_KEY)).toBe('1')

    // Even if random now says "not sampled", the cached decision wins.
    rand.mockReturnValue(0.9)
    const second = isSessionSampled(0.5)
    expect(second).toBe(true)
    // random called once for the decision, not again on the cached read.
    expect(rand).toHaveBeenCalledTimes(1)
  })

  it('caches a negative decision too', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.9) // 0.9 < 0.5 false → not sampled
    expect(isSessionSampled(0.5)).toBe(false)
    expect(sessionStorage.getItem(SESSION_SAMPLED_KEY)).toBe('0')
    expect(isSessionSampled(0.5)).toBe(false)
  })

  it('re-decides after a new session clears the cached flag', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.9)
    expect(isSessionSampled(0.5)).toBe(false)
    expect(sessionStorage.getItem(SESSION_SAMPLED_KEY)).toBe('0')

    // New session → flag cleared → new decision (now sampled).
    sessionStorage.setItem(SESSION_TS_KEY, String(Date.now() - TIMEOUT_MS - 1))
    vi.spyOn(Math, 'random').mockReturnValue(0.1)
    expect(isSessionSampled(0.5)).toBe(true)
    expect(sessionStorage.getItem(SESSION_SAMPLED_KEY)).toBe('1')
  })
})

describe('touchSession', () => {
  it('updates the session timestamp', () => {
    getSessionId()
    const before = sessionStorage.getItem(SESSION_TS_KEY)
    vi.useFakeTimers()
    vi.advanceTimersByTime(1000)
    touchSession()
    const after = sessionStorage.getItem(SESSION_TS_KEY)
    expect(after).not.toBe(before)
    expect(Number(after)).toBeGreaterThan(Number(before))
  })
})
