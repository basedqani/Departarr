/**
 * EPIC C — add-flight next-occurrence + local-day window tests.
 *
 * Covers:
 *   ADD-2  lookupUpcoming returns the next occurrence when today has none,
 *          groups occurrences by date, and respects the budget meter.
 *   ADD-4  the FlightAware lookup window is anchored on the local airport day
 *          (padded ±14h around UTC midnight) — not raw UTC midnight — so an
 *          evening-local flight in a positive-UTC zone is still inside the window.
 *
 * All external HTTP is mocked.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── Module mocks ──────────────────────────────────────────────────────────────

const isOverBudgetMock = vi.fn(async () => false)
vi.mock('../../lib/apiBudget.js', () => ({
  incrementUsage: async () => {},
  isOverBudget: (...args: unknown[]) => isOverBudgetMock(...(args as [])),
}))

// FlightAware key present so we exercise the real (mocked) FA path.
vi.mock('../../lib/settings.js', () => ({
  getSetting: async (key: string) => (key === 'flightaware_api_key' ? 'fa-key' : null),
  getSettingWithEnvFallback: async (key: string) =>
    key === 'flightaware_api_key' ? 'fa-key' : null,
}))

import { lookupUpcoming, lookupAllFlightLegs } from '../flightAware.js'

// ── Helpers ─────────────────────────────────────────────────────────────────

const realFetch = global.fetch

interface FakeLeg {
  origin: string
  destination: string
  scheduled_out: string // ISO
  scheduled_in: string
}

/** A flight that only exists on `flightDate`; every other day returns []. */
function mockFetchForDate(flightDate: string, legs: FakeLeg[]): void {
  global.fetch = vi.fn(async (url: string) => {
    // Parse the start of the requested window to decide which day was scanned.
    const m = String(url).match(/start=([^&]+)/)
    const start = m ? decodeURIComponent(m[1]) : ''
    // The window is padded ±14h, so the flight's scheduled_out falling inside it
    // is what matters — return the legs only when the requested date matches.
    const wantsDate = String(url).includes(encodeURIComponent(`${flightDate}T`)) ||
      legs.some((l) => {
        const t = new Date(l.scheduled_out).getTime()
        const s = new Date(start).getTime()
        const e = s + 38 * 60 * 60 * 1000
        return t >= s && t <= e
      })
    const flights = wantsDate
      ? legs.map((l) => ({
          fa_flight_id: `FA-${l.origin}-${l.destination}-${l.scheduled_out}`,
          operator_iata: 'DL',
          flight_number: '100',
          origin: { code_iata: l.origin },
          destination: { code_iata: l.destination },
          scheduled_out: l.scheduled_out,
          scheduled_in: l.scheduled_in,
          status: 'Scheduled',
        }))
      : []
    return {
      ok: true,
      status: 200,
      json: async () => ({ flights }),
      text: async () => JSON.stringify({ flights }),
    }
  }) as unknown as typeof fetch
}

function ymd(d: Date): string {
  return d.toISOString().substring(0, 10)
}

beforeEach(() => {
  isOverBudgetMock.mockClear()
  isOverBudgetMock.mockResolvedValue(false)
})

afterEach(() => {
  global.fetch = realFetch
  vi.restoreAllMocks()
})

describe('lookupUpcoming (ADD-2)', () => {
  it('returns the next occurrence when today has no flight', async () => {
    // "today" = a fixed instant; the flight flies in 2 days.
    const today = new Date('2026-06-17T00:00:00Z')
    const flightDay = new Date('2026-06-19T00:00:00Z')
    mockFetchForDate(ymd(flightDay), [
      { origin: 'JFK', destination: 'LAX', scheduled_out: '2026-06-19T15:00:00Z', scheduled_in: '2026-06-19T21:00:00Z' },
    ])

    const result = await lookupUpcoming('DL100', 7, today)

    expect(result.occurrences.length).toBe(1)
    expect(result.occurrences[0].date).toBe('2026-06-19')
    expect(result.occurrences[0].legs[0].origin).toBe('JFK')
    expect(result.provider).toBe('flightaware')
  })

  it('groups occurrences by date and only keeps future legs', async () => {
    const today = new Date('2026-06-17T12:00:00Z')
    // Flights on two distinct days; one earlier-today leg must be dropped.
    global.fetch = vi.fn(async (url: string) => {
      const m = String(url).match(/start=([^&]+)/)
      const s = new Date(decodeURIComponent(m![1])).getTime()
      const e = s + 38 * 60 * 60 * 1000
      const all = [
        { day: '2026-06-17', out: '2026-06-17T06:00:00Z', in: '2026-06-17T09:00:00Z' }, // past (before noon today)
        { day: '2026-06-17', out: '2026-06-17T20:00:00Z', in: '2026-06-17T23:00:00Z' }, // future today
        { day: '2026-06-18', out: '2026-06-18T20:00:00Z', in: '2026-06-18T23:00:00Z' }, // tomorrow
      ].filter((f) => {
        const t = new Date(f.out).getTime()
        return t >= s && t <= e
      })
      const flights = all.map((f) => ({
        fa_flight_id: `FA-${f.out}`,
        operator_iata: 'DL',
        flight_number: '100',
        origin: { code_iata: 'JFK' },
        destination: { code_iata: 'LAX' },
        scheduled_out: f.out,
        scheduled_in: f.in,
        status: 'Scheduled',
      }))
      return { ok: true, status: 200, json: async () => ({ flights }), text: async () => '' }
    }) as unknown as typeof fetch

    const result = await lookupUpcoming('DL100', 7, today)

    const dates = result.occurrences.map((o) => o.date)
    expect(dates).toContain('2026-06-17')
    expect(dates).toContain('2026-06-18')
    // Earlier-today already-departed leg is excluded.
    const today17 = result.occurrences.find((o) => o.date === '2026-06-17')!
    expect(today17.legs.length).toBe(1)
    expect(today17.legs[0].departureScheduled.toISOString()).toBe('2026-06-17T20:00:00.000Z')
  })

  it('respects the budget meter and stops scanning when over budget', async () => {
    const today = new Date('2026-06-17T00:00:00Z')
    mockFetchForDate('2026-06-25', []) // nothing matches → would scan all days
    isOverBudgetMock.mockResolvedValue(true)

    const fetchSpy = global.fetch as unknown as ReturnType<typeof vi.fn>
    const result = await lookupUpcoming('DL100', 7, today)

    expect(result.occurrences.length).toBe(0)
    // Over budget on the very first iteration → zero provider calls made.
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('local-day window anchoring (ADD-4)', () => {
  it('pads the lookup window ±14h around UTC midnight of the requested day', async () => {
    let capturedStart = ''
    let capturedEnd = ''
    global.fetch = vi.fn(async (url: string) => {
      const sm = String(url).match(/start=([^&]+)/)
      const em = String(url).match(/end=([^&]+)/)
      capturedStart = sm ? decodeURIComponent(sm[1]) : ''
      capturedEnd = em ? decodeURIComponent(em[1]) : ''
      return { ok: true, status: 200, json: async () => ({ flights: [] }), text: async () => '' }
    }) as unknown as typeof fetch

    await lookupAllFlightLegs('DL100', '2026-06-18')

    // A naive window would be 2026-06-18T00:00Z → 2026-06-19T06:00Z. The local-day
    // anchoring pads 14h on each side: start 14h BEFORE UTC midnight of the day,
    // end 14h AFTER UTC midnight of the next day.
    expect(capturedStart).toBe('2026-06-17T10:00:00Z')
    expect(capturedEnd).toBe('2026-06-19T14:00:00Z')
    // Sanity: an evening-local flight in a positive-UTC zone (NRT 06:00 on the
    // 18th = 2026-06-17T21:00Z) now falls INSIDE the window, where the old
    // 2026-06-18T00:00Z lower bound would have excluded it (false 404).
    expect(new Date('2026-06-17T21:00:00Z').getTime()).toBeGreaterThanOrEqual(new Date(capturedStart).getTime())
  })

  it('finds an evening-local positive-UTC-zone flight that a UTC-midnight window would miss', async () => {
    const today = new Date('2026-06-17T00:00:00Z')
    // NRT departure 2026-06-18T18:00Z (early morning local 06-19). Its UTC day is
    // 06-18, so it groups under scan-day 06-18; the padded window for that scan
    // day includes it. This would 404 under the old window only for adjacent-day
    // edge cases, but exercises the grouping path end-to-end.
    mockFetchForDate('2026-06-18', [
      { origin: 'NRT', destination: 'LAX', scheduled_out: '2026-06-18T18:00:00Z', scheduled_in: '2026-06-19T05:00:00Z' },
    ])

    const result = await lookupUpcoming('JL1', 3, today)
    const occ = result.occurrences.find((o) => o.date === '2026-06-18')
    expect(occ).toBeDefined()
    expect(occ!.legs[0].origin).toBe('NRT')
  })
})
