/**
 * EPIC G — calendar sync cost-safety + edit detection + train re-enable.
 *
 * Covers:
 *   CAL-1  over-budget account makes ZERO billable provider calls during sync,
 *          but still imports the event as a stub.
 *   CAL-2  at most one FlightAware call per new flight event (no redundant
 *          lookupFlight + lookupAllFlightLegs double-call).
 *   CAL-3  a changed Google event.updated timestamp re-enriches; an unchanged
 *          one is skipped.
 *   CAL-8  a train-name event whose only number is a platform number does not
 *          yield a bogus train number.
 *
 * All external HTTP / Google APIs are mocked.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mocks ───────────────────────────────────────────────────────────────────

const lookupFlightMock = vi.fn()
const lookupAllFlightLegsMock = vi.fn()
const isOverBudgetMock = vi.fn(async () => false)

vi.mock('../flightAware.js', () => ({
  lookupFlight: (...a: unknown[]) => lookupFlightMock(...a),
  lookupAllFlightLegs: (...a: unknown[]) => lookupAllFlightLegsMock(...a),
  isActiveProviderOverBudget: () => isOverBudgetMock(),
}))

vi.mock('../gtfs.js', () => ({
  lookupTrainSchedule: vi.fn(async () => null),
}))

vi.mock('../../lib/settings.js', () => ({
  getSettingWithEnvFallback: async () => null,
}))

// Google calendar: a single configurable event list.
let mockEvents: unknown[] = []
vi.mock('googleapis', () => ({
  google: {
    auth: { OAuth2: class { setCredentials() {} on() {} } },
    calendar: () => ({
      events: {
        list: async () => ({ data: { items: mockEvents, nextPageToken: undefined, nextSyncToken: 'tok-1' } }),
      },
    }),
  },
}))

// Prisma: in-memory flight/train stores keyed by what the sync needs.
interface Row { id: string; [k: string]: unknown }
let flights: Row[] = []
let trains: Row[] = []
let connection: Row | null = null
let idSeq = 0

vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    calendarConnection: {
      findFirst: async () => connection,
      update: async () => connection,
    },
    flight: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) => {
        if (where.calendarEventId)
          return flights.find((f) => f.calendarEventId === where.calendarEventId) ?? null
        if (where.ident)
          return flights.find((f) => f.ident === where.ident) ?? null
        return null
      },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `f${idSeq++}`, ...data }
        flights.push(row)
        return row
      },
      delete: async ({ where }: { where: { id: string } }) => {
        flights = flights.filter((f) => f.id !== where.id)
        return {}
      },
    },
    train: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) => {
        if (where.calendarEventId)
          return trains.find((t) => t.calendarEventId === where.calendarEventId) ?? null
        if (where.trainNumber)
          return trains.find((t) => t.trainNumber === where.trainNumber) ?? null
        return null
      },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `t${idSeq++}`, ...data }
        trains.push(row)
        return row
      },
      delete: async ({ where }: { where: { id: string } }) => {
        trains = trains.filter((t) => t.id !== where.id)
        return {}
      },
    },
    setting: { upsert: async () => ({}) },
  },
}))

import { syncCalendarForUser } from '../googleCalendar.js'
import { detectTrainsInText } from '../trainDetector.js'

const FUTURE = '2026-12-01'

function flightEvent(over: Record<string, unknown> = {}) {
  return {
    id: 'evt-1',
    updated: '2026-06-17T10:00:00Z',
    summary: 'Flight DL100',
    start: { dateTime: `${FUTURE}T15:00:00Z` },
    end: { dateTime: `${FUTURE}T18:00:00Z` },
    ...over,
  }
}

function realLeg() {
  return {
    faFlightId: 'fa1',
    airlineIata: 'DL',
    flightNumber: '100',
    origin: 'JFK',
    destination: 'LAX',
    departureScheduled: new Date(`${FUTURE}T15:00:00Z`),
    arrivalScheduled: new Date(`${FUTURE}T18:00:00Z`),
    status: 'scheduled',
  }
}

beforeEach(() => {
  flights = []
  trains = []
  idSeq = 0
  connection = { id: 'c1', userId: 'u1', provider: 'google', accessToken: 'a', refreshToken: 'r', syncToken: null }
  mockEvents = []
  lookupFlightMock.mockReset()
  lookupAllFlightLegsMock.mockReset()
  isOverBudgetMock.mockReset()
  isOverBudgetMock.mockResolvedValue(false)
})

describe('CAL-1 over-budget → no paid call, stub saved', () => {
  it('makes zero billable calls when over budget but still imports a stub', async () => {
    isOverBudgetMock.mockResolvedValue(true)
    mockEvents = [flightEvent()]

    const res = await syncCalendarForUser('u1')

    expect(lookupFlightMock).not.toHaveBeenCalled()
    expect(lookupAllFlightLegsMock).not.toHaveBeenCalled()
    expect(res.flightsFound).toBe(1)
    expect(flights).toHaveLength(1)
    expect(flights[0].faFlightId).toBeNull() // stub
  })
})

describe('CAL-2 ≤1 FA call per new flight event', () => {
  it('uses a single lookupAllFlightLegs call when no route hint (no double-call)', async () => {
    lookupAllFlightLegsMock.mockResolvedValue([realLeg()])
    mockEvents = [flightEvent()] // summary "Flight DL100" → no origin/dest hint

    await syncCalendarForUser('u1')

    const total = lookupFlightMock.mock.calls.length + lookupAllFlightLegsMock.mock.calls.length
    expect(total).toBe(1)
    expect(lookupAllFlightLegsMock).toHaveBeenCalledTimes(1)
    expect(flights).toHaveLength(1)
    expect(flights[0].faFlightId).toBe('fa1')
  })
})

describe('CAL-3 edited-event detection', () => {
  it('re-enriches when event.updated changes; skips when unchanged', async () => {
    lookupAllFlightLegsMock.mockResolvedValue([realLeg()])

    // First sync imports.
    mockEvents = [flightEvent({ updated: '2026-06-17T10:00:00Z' })]
    await syncCalendarForUser('u1')
    expect(flights).toHaveLength(1)
    expect(lookupAllFlightLegsMock).toHaveBeenCalledTimes(1)

    // Second sync, SAME updated → skip, no new call.
    await syncCalendarForUser('u1')
    expect(flights).toHaveLength(1)
    expect(lookupAllFlightLegsMock).toHaveBeenCalledTimes(1)

    // Third sync, CHANGED updated → re-enrich (delete + recreate, one more call).
    mockEvents = [flightEvent({ updated: '2026-06-18T09:00:00Z' })]
    await syncCalendarForUser('u1')
    expect(flights).toHaveLength(1)
    expect(lookupAllFlightLegsMock).toHaveBeenCalledTimes(2)
  })
})

describe('CAL-8 platform number is not a train number', () => {
  it('does not extract a platform number adjacent to a train name', () => {
    const res = detectTrainsInText('Empire Builder, depart from platform 12')
    expect(res).toHaveLength(0)
  })

  it('still extracts a genuine adjacent/keyword train number', () => {
    expect(detectTrainsInText('Empire Builder 8 to Chicago')[0]?.trainNumber).toBe('8')
    expect(detectTrainsInText('Empire Builder (Train #8)')[0]?.trainNumber).toBe('8')
  })
})
