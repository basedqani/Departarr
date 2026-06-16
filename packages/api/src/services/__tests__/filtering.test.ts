/**
 * Unit tests for Today/Upcoming/Past filter logic and auto-itinerary grouping.
 *
 * Run with: npx vitest run src/services/__tests__/filtering.test.ts
 */

import { describe, it, expect } from 'vitest'

// ─── Shared arrived-status list (mirrors flights.ts / trains.ts) ──────────────

const ARRIVED_STATUSES = ['landed', 'arrived', 'cancelled', 'Landed', 'Arrived', 'Cancelled']

// ─── Today filter helpers (pure logic extracted from the Prisma WHERE clause) ──

interface LegTimestamps {
  departureScheduled: Date
  arrivalScheduled: Date | null
  arrivalEstimated: Date | null
  arrivalActual: Date | null
  status: string
}

/**
 * Returns true if this leg should appear in the "today" bucket.
 * Mirrors the OR clause in flights.ts / trains.ts when=today.
 */
function isTodayLeg(leg: LegTimestamps, startOfDay: Date, endOfDay: Date, now: Date): boolean {
  // Must depart today (local)
  if (leg.departureScheduled < startOfDay || leg.departureScheduled > endOfDay) return false

  // Must not have arrived yet
  if (leg.arrivalActual !== null) {
    return leg.arrivalActual > now
  }
  if (leg.arrivalEstimated !== null) {
    return leg.arrivalEstimated > now
  }
  if (leg.arrivalScheduled !== null) {
    return leg.arrivalScheduled > now
  }
  // No arrival timestamps at all — fall back to status
  return !ARRIVED_STATUSES.includes(leg.status)
}

/**
 * Returns true if this leg should appear in the "past" bucket.
 * Mirrors the OR clause in flights.ts / trains.ts when=past.
 */
function isPastLeg(leg: LegTimestamps, now: Date): boolean {
  if (leg.arrivalActual !== null) return leg.arrivalActual <= now
  if (leg.arrivalEstimated !== null) return leg.arrivalEstimated <= now
  if (leg.arrivalScheduled !== null) return leg.arrivalScheduled <= now
  return ARRIVED_STATUSES.includes(leg.status)
}

/**
 * Returns true if this leg should appear in the "upcoming" bucket.
 * Mirrors the simple departureScheduled > now check.
 */
function isUpcomingLeg(leg: LegTimestamps, now: Date): boolean {
  return leg.departureScheduled > now
}

// ─── Auto-itinerary grouping (mirrors tripGrouping.ts buildAutoItineraries) ───

const AUTO_GROUP_MAX_GAP_MS = 4 * 60 * 60 * 1000 // 4 hours

interface SimpleLeg {
  id: string
  origin: string
  destination: string
  departureScheduled: string
  arrivalScheduled: string
  arrivalEstimated: string | null
  arrivalActual: string | null
}

interface AutoGroup {
  legs: SimpleLeg[]
}

function buildAutoItineraries(legs: SimpleLeg[]): { grouped: AutoGroup[]; remaining: SimpleLeg[] } {
  const sorted = [...legs].sort(
    (a, b) => new Date(a.departureScheduled).getTime() - new Date(b.departureScheduled).getTime()
  )

  const used = new Set<number>()
  const grouped: AutoGroup[] = []

  for (let i = 0; i < sorted.length; i++) {
    if (used.has(i)) continue
    const chainIdx: number[] = [i]
    let last = sorted[i]

    for (let j = i + 1; j < sorted.length; j++) {
      if (used.has(j)) continue
      const next = sorted[j]
      if (last.destination !== next.origin) continue
      const arrBest = last.arrivalActual ?? last.arrivalEstimated ?? last.arrivalScheduled
      const gap = new Date(next.departureScheduled).getTime() - new Date(arrBest).getTime()
      if (gap >= 0 && gap <= AUTO_GROUP_MAX_GAP_MS) {
        chainIdx.push(j)
        last = next
      }
    }

    if (chainIdx.length >= 2) {
      for (const idx of chainIdx) used.add(idx)
      grouped.push({ legs: chainIdx.map(idx => sorted[idx]) })
    }
  }

  const remaining = sorted.filter((_, idx) => !used.has(idx))
  return { grouped, remaining }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function hoursFromNow(h: number): Date {
  return new Date(Date.now() + h * 60 * 60 * 1000)
}

function isoFromNow(h: number): string {
  return hoursFromNow(h).toISOString()
}

function todayMidnight(): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

function todayEndOfDay(): Date {
  const d = new Date()
  d.setHours(23, 59, 59, 999)
  return d
}

// ─── TODAY filter tests ───────────────────────────────────────────────────────

describe('Today filter — isTodayLeg', () => {
  const now = new Date()
  const start = todayMidnight()
  const end = todayEndOfDay()

  it('shows a flight that departs today and has not arrived yet (future arrivalActual)', () => {
    const leg: LegTimestamps = {
      departureScheduled: hoursFromNow(-1),
      arrivalScheduled: hoursFromNow(3),
      arrivalEstimated: null,
      arrivalActual: hoursFromNow(2), // arrives in 2h
      status: 'en-route',
    }
    expect(isTodayLeg(leg, start, end, now)).toBe(true)
  })

  it('removes a flight whose arrivalActual is in the past even if status is still "scheduled"', () => {
    const leg: LegTimestamps = {
      departureScheduled: hoursFromNow(-5),
      arrivalScheduled: hoursFromNow(-2),
      arrivalEstimated: null,
      arrivalActual: hoursFromNow(-1), // already arrived
      status: 'scheduled', // stale status — must NOT override arrivalActual
    }
    expect(isTodayLeg(leg, start, end, now)).toBe(false)
  })

  it('removes a flight whose arrivalEstimated is in the past (no arrivalActual)', () => {
    const leg: LegTimestamps = {
      departureScheduled: hoursFromNow(-4),
      arrivalScheduled: hoursFromNow(-2),
      arrivalEstimated: hoursFromNow(-0.5), // arrived 30 min ago
      arrivalActual: null,
      status: 'scheduled',
    }
    expect(isTodayLeg(leg, start, end, now)).toBe(false)
  })

  it('removes a flight with status "arrived" and no arrival timestamps', () => {
    const leg: LegTimestamps = {
      departureScheduled: hoursFromNow(-3),
      arrivalScheduled: null,
      arrivalEstimated: null,
      arrivalActual: null,
      status: 'arrived',
    }
    expect(isTodayLeg(leg, start, end, now)).toBe(false)
  })

  it('keeps a flight with status "scheduled" and no arrival timestamps (pre-flight)', () => {
    const leg: LegTimestamps = {
      departureScheduled: hoursFromNow(2),
      arrivalScheduled: null,
      arrivalEstimated: null,
      arrivalActual: null,
      status: 'scheduled',
    }
    expect(isTodayLeg(leg, start, end, now)).toBe(true)
  })

  it('does not show a flight departing yesterday', () => {
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000)
    yesterday.setHours(10, 0, 0, 0)
    const leg: LegTimestamps = {
      departureScheduled: yesterday,
      arrivalScheduled: hoursFromNow(5),
      arrivalEstimated: null,
      arrivalActual: null,
      status: 'scheduled',
    }
    expect(isTodayLeg(leg, start, end, now)).toBe(false)
  })

  it('keeps an en-route flight that departed today but arrives tomorrow', () => {
    // departure was earlier today, arrival is tomorrow
    const earlyToday = new Date()
    earlyToday.setHours(2, 0, 0, 0) // 2 AM today
    const leg: LegTimestamps = {
      departureScheduled: earlyToday,
      arrivalScheduled: hoursFromNow(30), // arrives tomorrow
      arrivalEstimated: null,
      arrivalActual: null,
      status: 'en-route',
    }
    expect(isTodayLeg(leg, start, end, now)).toBe(true)
  })
})

// ─── PAST filter tests ────────────────────────────────────────────────────────

describe('Past filter — isPastLeg', () => {
  const now = new Date()

  it('puts a flight with arrivalActual in the past into Past', () => {
    const leg: LegTimestamps = {
      departureScheduled: hoursFromNow(-5),
      arrivalScheduled: hoursFromNow(-2),
      arrivalEstimated: null,
      arrivalActual: hoursFromNow(-1),
      status: 'landed',
    }
    expect(isPastLeg(leg, now)).toBe(true)
  })

  it('does NOT put an en-route flight (departed but not arrived) into Past', () => {
    const leg: LegTimestamps = {
      departureScheduled: hoursFromNow(-2),
      arrivalScheduled: hoursFromNow(1),
      arrivalEstimated: null,
      arrivalActual: null,
      status: 'en-route',
    }
    expect(isPastLeg(leg, now)).toBe(false)
  })

  it('puts a cancelled flight into Past via status', () => {
    const leg: LegTimestamps = {
      departureScheduled: hoursFromNow(-1),
      arrivalScheduled: hoursFromNow(2),
      arrivalEstimated: null,
      arrivalActual: null,
      status: 'cancelled',
    }
    expect(isPastLeg(leg, now)).toBe(true)
  })

  it('uses arrivalEstimated when arrivalActual is null', () => {
    const leg: LegTimestamps = {
      departureScheduled: hoursFromNow(-3),
      arrivalScheduled: hoursFromNow(-1),
      arrivalEstimated: hoursFromNow(-0.5),
      arrivalActual: null,
      status: 'landed',
    }
    expect(isPastLeg(leg, now)).toBe(true)
  })
})

// ─── UPCOMING filter tests ────────────────────────────────────────────────────

describe('Upcoming filter — isUpcomingLeg', () => {
  const now = new Date()

  it('shows a flight departing in the future', () => {
    const leg: LegTimestamps = {
      departureScheduled: hoursFromNow(5),
      arrivalScheduled: hoursFromNow(8),
      arrivalEstimated: null,
      arrivalActual: null,
      status: 'scheduled',
    }
    expect(isUpcomingLeg(leg, now)).toBe(true)
  })

  it('does not show a flight with past departure in upcoming', () => {
    const leg: LegTimestamps = {
      departureScheduled: hoursFromNow(-1),
      arrivalScheduled: hoursFromNow(2),
      arrivalEstimated: null,
      arrivalActual: null,
      status: 'en-route',
    }
    expect(isUpcomingLeg(leg, now)).toBe(false)
  })
})

// ─── AUTO-ITINERARY grouping tests ───────────────────────────────────────────

describe('buildAutoItineraries', () => {
  it('single standalone leg stays in remaining, not in grouped', () => {
    const leg: SimpleLeg = {
      id: 'f1',
      origin: 'ORD',
      destination: 'SEA',
      departureScheduled: isoFromNow(2),
      arrivalScheduled: isoFromNow(5),
      arrivalEstimated: null,
      arrivalActual: null,
    }
    const { grouped, remaining } = buildAutoItineraries([leg])
    expect(grouped).toHaveLength(0)
    expect(remaining).toHaveLength(1)
    expect(remaining[0].id).toBe('f1')
  })

  it('two connecting legs (same airport, gap ≤ 4h) get grouped into one auto-itinerary', () => {
    const leg1: SimpleLeg = {
      id: 'f1',
      origin: 'ORD',
      destination: 'SEA',
      departureScheduled: isoFromNow(1),
      arrivalScheduled: isoFromNow(4),
      arrivalEstimated: null,
      arrivalActual: null,
    }
    const leg2: SimpleLeg = {
      id: 'f2',
      origin: 'SEA',
      destination: 'NRT',
      departureScheduled: isoFromNow(5), // 1h after leg1 lands
      arrivalScheduled: isoFromNow(15),
      arrivalEstimated: null,
      arrivalActual: null,
    }
    const { grouped, remaining } = buildAutoItineraries([leg1, leg2])
    expect(grouped).toHaveLength(1)
    expect(grouped[0].legs.map(l => l.id)).toEqual(['f1', 'f2'])
    expect(remaining).toHaveLength(0)
  })

  it('two legs with gap > 4h are NOT grouped', () => {
    const leg1: SimpleLeg = {
      id: 'f1',
      origin: 'ORD',
      destination: 'SEA',
      departureScheduled: isoFromNow(1),
      arrivalScheduled: isoFromNow(4),
      arrivalEstimated: null,
      arrivalActual: null,
    }
    const leg2: SimpleLeg = {
      id: 'f2',
      origin: 'SEA',
      destination: 'NRT',
      departureScheduled: isoFromNow(9), // 5h after leg1 lands — exceeds 4h window
      arrivalScheduled: isoFromNow(19),
      arrivalEstimated: null,
      arrivalActual: null,
    }
    const { grouped, remaining } = buildAutoItineraries([leg1, leg2])
    expect(grouped).toHaveLength(0)
    expect(remaining).toHaveLength(2)
  })

  it('two legs with different connecting airports are NOT grouped', () => {
    const leg1: SimpleLeg = {
      id: 'f1',
      origin: 'ORD',
      destination: 'SEA',
      departureScheduled: isoFromNow(1),
      arrivalScheduled: isoFromNow(4),
      arrivalEstimated: null,
      arrivalActual: null,
    }
    const leg2: SimpleLeg = {
      id: 'f2',
      origin: 'LAX', // different airport — not connecting
      destination: 'NRT',
      departureScheduled: isoFromNow(5),
      arrivalScheduled: isoFromNow(15),
      arrivalEstimated: null,
      arrivalActual: null,
    }
    const { grouped, remaining } = buildAutoItineraries([leg1, leg2])
    expect(grouped).toHaveLength(0)
    expect(remaining).toHaveLength(2)
  })

  it('uses arrivalActual over arrivalScheduled when computing gap', () => {
    // leg1 scheduled arrival is 4h from now, but actual was 3h — gap with leg2 should be 2h (within 4h window)
    const leg1: SimpleLeg = {
      id: 'f1',
      origin: 'ORD',
      destination: 'SEA',
      departureScheduled: isoFromNow(0.5),
      arrivalScheduled: isoFromNow(4),
      arrivalEstimated: null,
      arrivalActual: isoFromNow(3), // arrived early
    }
    const leg2: SimpleLeg = {
      id: 'f2',
      origin: 'SEA',
      destination: 'NRT',
      departureScheduled: isoFromNow(5), // 2h after actual arrival — within 4h window
      arrivalScheduled: isoFromNow(15),
      arrivalEstimated: null,
      arrivalActual: null,
    }
    const { grouped, remaining } = buildAutoItineraries([leg1, leg2])
    expect(grouped).toHaveLength(1)
    expect(remaining).toHaveLength(0)
  })

  it('three-leg chain all within window gets grouped together', () => {
    const legs: SimpleLeg[] = [
      {
        id: 'f1', origin: 'JFK', destination: 'ORD',
        departureScheduled: isoFromNow(1), arrivalScheduled: isoFromNow(3),
        arrivalEstimated: null, arrivalActual: null,
      },
      {
        id: 'f2', origin: 'ORD', destination: 'SEA',
        departureScheduled: isoFromNow(4), arrivalScheduled: isoFromNow(6),
        arrivalEstimated: null, arrivalActual: null,
      },
      {
        id: 'f3', origin: 'SEA', destination: 'NRT',
        departureScheduled: isoFromNow(7), arrivalScheduled: isoFromNow(17),
        arrivalEstimated: null, arrivalActual: null,
      },
    ]
    const { grouped, remaining } = buildAutoItineraries(legs)
    expect(grouped).toHaveLength(1)
    expect(grouped[0].legs).toHaveLength(3)
    expect(remaining).toHaveLength(0)
  })
})
