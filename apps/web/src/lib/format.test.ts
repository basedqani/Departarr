import { describe, it, expect } from 'vitest'
import {
  getAirportTz,
  getAmtrakStationTz,
  formatTimeInZone,
  formatLocalTime,
  formatTime,
  formatRelativeDayInZone,
} from './format'

// The machine timezone these tests run on. Used to assert that an unknown code
// NEVER resolves to (or renders in) the viewer's local zone.
const MACHINE_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone

// Modern ICU inserts a narrow no-break space (U+202F) before AM/PM. Normalize to
// a regular space so assertions are readable and ICU-version-independent.
const norm = (s: string): string => s.replace(/ /g, ' ')

describe('getAirportTz', () => {
  it('resolves a known airport to the correct IANA zone (from dataset)', () => {
    expect(getAirportTz('ORD')).toBe('America/Chicago')
    expect(getAirportTz('LAX')).toBe('America/Los_Angeles')
    expect(getAirportTz('LHR')).toBe('Europe/London')
    expect(getAirportTz('NRT')).toBe('Asia/Tokyo')
  })

  it('is case-insensitive', () => {
    expect(getAirportTz('jfk')).toBe('America/New_York')
  })

  it('resolves obscure airports via the full dataset, not just the fallback map', () => {
    // KEF (Keflavik) is not in the small hard-coded map but is in OpenFlights.
    expect(getAirportTz('KEF')).toBe('Atlantic/Reykjavik')
  })

  it('returns null for an unknown code — NEVER the machine timezone', () => {
    expect(getAirportTz('ZZZ')).toBeNull()
    expect(getAirportTz('ZZZ')).not.toBe(MACHINE_TZ)
    expect(getAirportTz('')).toBeNull()
  })
})

describe('getAmtrakStationTz', () => {
  it('resolves a known station to the correct IANA zone', () => {
    expect(getAmtrakStationTz('CHI')).toBe('America/Chicago')
    expect(getAmtrakStationTz('NYP')).toBe('America/New_York')
  })

  it('returns null for an unknown code — NEVER the machine timezone', () => {
    expect(getAmtrakStationTz('XXX')).toBeNull()
    expect(getAmtrakStationTz('XXX')).not.toBe(MACHINE_TZ)
  })
})

describe('formatTimeInZone', () => {
  it('renders a UTC instant as the correct wall-clock time + abbr in a given zone', () => {
    // 22:30Z on 2026-06-13 is 17:30 CDT (UTC-5, summer) in Chicago.
    expect(norm(formatTimeInZone('2026-06-13T22:30:00Z', 'America/Chicago'))).toBe('05:30 PM CDT')
  })

  it('renders correctly in a far-east zone (Tokyo, UTC+9)', () => {
    expect(norm(formatTimeInZone('2026-06-13T22:30:00Z', 'Asia/Tokyo'))).toBe('07:30 AM GMT+9')
  })

  it('falls back to UTC (with label) when tz is null/undefined — never machine tz', () => {
    expect(norm(formatTimeInZone('2026-06-13T22:30:00Z', null))).toBe('10:30 PM UTC')
    expect(norm(formatTimeInZone('2026-06-13T22:30:00Z', undefined))).toBe('10:30 PM UTC')
  })
})

describe('formatLocalTime', () => {
  it('always includes a tz abbreviation so the offset is self-evident', () => {
    expect(norm(formatLocalTime('2026-06-13T22:30:00Z', 'America/Chicago'))).toBe('05:30 PM CDT')
  })

  it('an unknown-zone time renders as UTC, NOT the machine zone', () => {
    const out = formatLocalTime('2026-06-13T22:30:00Z', getAirportTz('ZZZ'))
    expect(norm(out)).toBe('10:30 PM UTC')
  })

  it('returns placeholder for missing input', () => {
    expect(formatLocalTime(null, 'America/Chicago')).toBe('--:--')
  })
})

describe('formatTime', () => {
  it('requires a tz and includes the abbreviation', () => {
    expect(norm(formatTime('2026-06-13T22:30:00Z', 'America/New_York'))).toBe('06:30 PM EDT')
  })
})

describe('formatRelativeDayInZone', () => {
  it('computes "tomorrow" relative to the flight origin zone, not the machine', () => {
    // In America/Chicago, 2026-06-13T23:00:00Z is still June 13 (18:00 CDT).
    // A target at 2026-06-14T18:00:00Z is June 14 CDT -> "tomorrow".
    const now = new Date('2026-06-13T23:00:00Z')
    const target = new Date('2026-06-14T18:00:00Z')
    expect(formatRelativeDayInZone(target, now, 'America/Chicago')).toBe('tomorrow')
  })

  it('day boundary is zone-dependent (Tokyo crosses midnight before UTC)', () => {
    // now: 2026-06-13T23:30:00Z -> already June 14 in Tokyo (UTC+9).
    // target: 2026-06-14T20:00:00Z -> June 15 in Tokyo -> "tomorrow".
    const now = new Date('2026-06-13T23:30:00Z')
    const target = new Date('2026-06-14T20:00:00Z')
    expect(formatRelativeDayInZone(target, now, 'Asia/Tokyo')).toBe('tomorrow')
  })

  it('returns "in N days" for 2-6 days out', () => {
    const now = new Date('2026-06-13T12:00:00Z')
    const target = new Date('2026-06-16T12:00:00Z')
    expect(formatRelativeDayInZone(target, now, 'UTC')).toBe('in 3 days')
  })
})
