import { prisma } from '../lib/prisma.js'
import { fetchFlightById, lookupFlight, type FlightData } from './flightAware.js'
import { sendPushToUser, sendPushToShareSubscribers, buildPushNotification } from './webPush.js'
import { wsClients } from '../lib/wsClients.js'
import { isActiveProviderOverBudget } from './flightAware.js'
import { normalizeStatus } from '../lib/flightStatus.js'
import type { Flight } from '@prisma/client'

const POLL_INTERVAL_MS = 60_000
const TERMINAL_STATUSES = new Set(['arrived', 'cancelled', 'diverted'])

// ── Interval constants (ms) ────────────────────────────────────────────────
const MIN_15  =  15 * 60 * 1000
const MIN_30  =  30 * 60 * 1000
const HOUR_1  =  60 * 60 * 1000
const HOUR_3  =   3 * 60 * 60 * 1000
const HOUR_12 =  12 * 60 * 60 * 1000

// ── Adaptive cadence ──────────────────────────────────────────────────────

/**
 * Returns the minimum ms that must have elapsed since lastPolledAt before we
 * should make another FlightAware call for this flight.
 */
export function requiredPollIntervalMs(flight: Flight, now: Date): number {
  const status = flight.status.toLowerCase()

  // 1. In-air: status says departed/en-route OR takeoff recorded but no landing
  const inAir =
    status === 'departed' ||
    status === 'en_route' ||
    status === 'en-route' ||
    (flight.takeoffActual != null && flight.arrivalActual == null)

  if (inAir) {
    // Within ~1h of estimated landing → 15 min, otherwise 30 min
    const landingEst =
      flight.landingEstimated ??
      flight.landingScheduled ??
      flight.arrivalEstimated ??
      flight.arrivalScheduled
    if (landingEst != null) {
      const msTilLanding = landingEst.getTime() - now.getTime()
      if (msTilLanding <= HOUR_1 && msTilLanding > -MIN_30) {
        return MIN_15
      }
    }
    return MIN_30
  }

  // 2. Overdue: past scheduled arrival but no actual arrival
  if (
    flight.arrivalActual == null &&
    flight.departureActual != null &&
    now.getTime() > (flight.arrivalScheduled ?? flight.arrivalEstimated ?? new Date(0)).getTime()
  ) {
    return MIN_30
  }

  // 3. Pre-departure: bucket by time until scheduled/estimated departure
  const depTime = (flight.departureEstimated ?? flight.departureScheduled).getTime()
  const msTilDep = depTime - now.getTime()

  if (msTilDep <= 0) {
    // Departed but not captured as in-air yet — poll fairly often
    return MIN_30
  } else if (msTilDep <= 3 * HOUR_1) {
    // Within 3h: every 15 min — high value window for gate/delay changes
    return MIN_15
  } else if (msTilDep <= 6 * HOUR_1) {
    // 3–6h out: every 30 min — still worth watching
    return MIN_30
  } else {
    // >6h out: don't poll at all — nothing actionable changes this far out.
    // Flight will be picked up again once it enters the 6h window.
    return HOUR_12
  }
}

// ── Diff helper ───────────────────────────────────────────────────────────

type FlightFields = Pick<
  Flight,
  | 'status'
  | 'gateDeparture'
  | 'gateArrival'
  | 'terminalDeparture'
  | 'terminalArrival'
  | 'baggageClaim'
  | 'departureEstimated'
  | 'departureActual'
  | 'arrivalEstimated'
  | 'arrivalActual'
  | 'takeoffEstimated'
  | 'takeoffActual'
  | 'landingEstimated'
  | 'landingActual'
>

interface FieldDiff {
  field: string
  eventType: string
  oldValue: string | null
  newValue: string | null
}

function diffFlights(stored: FlightFields, fresh: FlightData): FieldDiff[] {
  const diffs: FieldDiff[] = []

  function check(
    field: string,
    eventType: string,
    oldVal: string | Date | null | undefined,
    newVal: string | Date | null | undefined
  ): void {
    const oldStr = oldVal != null ? String(oldVal) : null
    const newStr = newVal != null ? String(newVal) : null
    if (oldStr !== newStr && newStr !== null) {
      diffs.push({ field, eventType, oldValue: oldStr, newValue: newStr })
    }
  }

  check('status', 'status_change', stored.status, fresh.status)
  check('gateDeparture', 'gate_change', stored.gateDeparture, fresh.gateDeparture)
  check('gateArrival', 'gate_change', stored.gateArrival, fresh.gateArrival)
  check('departureEstimated', 'delay', stored.departureEstimated, fresh.departureEstimated)
  check('departureActual', 'departure', stored.departureActual, fresh.departureActual)
  check('arrivalEstimated', 'delay', stored.arrivalEstimated, fresh.arrivalEstimated)
  check('arrivalActual', 'arrival', stored.arrivalActual, fresh.arrivalActual)
  check('baggageClaim', 'baggage', stored.baggageClaim, fresh.baggageClaim)
  check('takeoffEstimated', 'delay', stored.takeoffEstimated, fresh.takeoffEstimated)
  // takeoffActual = wheels-off (runway detection); use distinct eventType so it
  // isn't deduplicated against departureActual (gate-out) in the same poll cycle.
  check('takeoffActual', 'takeoff', stored.takeoffActual, fresh.takeoffActual)
  check('landingEstimated', 'delay', stored.landingEstimated, fresh.landingEstimated)
  check('landingActual', 'arrival', stored.landingActual, fresh.landingActual)

  // Cancellation
  if (fresh.status === 'cancelled' && stored.status !== 'cancelled') {
    diffs.push({ field: 'status', eventType: 'cancellation', oldValue: stored.status, newValue: 'cancelled' })
  }

  return diffs
}

// ── Per-flight apply (write DB + notify) ──────────────────────────────────

async function applyFreshData(flight: Flight, fresh: FlightData): Promise<void> {
  // Fix 1: First-ever poll — silently write baseline, no notifications
  if (flight.lastPolledAt === null) {
    await prisma.flight.update({
      where: { id: flight.id },
      data: {
        status: normalizeStatus(fresh.status).status,
        // DE-2: persist registration so ADSB hex/reg lookup works. Only
        // overwrite when the provider actually supplies a value.
        registration: fresh.registration ?? flight.registration ?? null,
        gateDeparture: fresh.gateDeparture ?? null,
        gateArrival: fresh.gateArrival ?? null,
        terminalDeparture: fresh.terminalDeparture ?? null,
        terminalArrival: fresh.terminalArrival ?? null,
        baggageClaim: fresh.baggageClaim ?? null,
        departureEstimated: fresh.departureEstimated ?? null,
        departureActual: fresh.departureActual ?? null,
        arrivalEstimated: fresh.arrivalEstimated ?? null,
        arrivalActual: fresh.arrivalActual ?? null,
        takeoffScheduled: fresh.takeoffScheduled ?? null,
        takeoffEstimated: fresh.takeoffEstimated ?? null,
        takeoffActual: fresh.takeoffActual ?? null,
        landingScheduled: fresh.landingScheduled ?? null,
        landingEstimated: fresh.landingEstimated ?? null,
        landingActual: fresh.landingActual ?? null,
        lastPolledAt: new Date(),
      },
    })
    return
  }

  const diffs = diffFlights(flight, fresh)

  if (diffs.length === 0) {
    await prisma.flight.update({ where: { id: flight.id }, data: { lastPolledAt: new Date() } })
    return
  }

  // Fix 2: Deduplicate by eventType — keep first occurrence only
  const seen = new Set<string>()
  const uniqueDiffs = diffs.filter(d => {
    if (seen.has(d.eventType)) return false
    seen.add(d.eventType)
    return true
  })

  // Fix 3: Suppress stale/irrelevant notifications based on flight state
  const alreadyDeparted =
    flight.departureActual != null ||
    fresh.status === 'en_route' ||
    fresh.status === 'en-route' ||
    fresh.status === 'arrived'

  const notifiableDiffs = uniqueDiffs.filter(d => {
    // Suppress departure delays once the plane has left
    if (
      alreadyDeparted &&
      d.eventType === 'delay' &&
      (d.field === 'departureEstimated' || d.field === 'takeoffEstimated')
    ) return false
    // Suppress gate changes after departure
    if (alreadyDeparted && d.eventType === 'gate_change') return false
    // Never notify for 'delay' on arrival fields when already arrived
    if (fresh.status === 'arrived' && d.eventType === 'delay') return false
    return true
  })

  // Write all diffs to history (full diffs, not deduplicated)
  await prisma.$transaction([
    prisma.flight.update({
      where: { id: flight.id },
      data: {
        status: normalizeStatus(fresh.status).status,
        // DE-2: persist registration for ADSB lookup.
        registration: fresh.registration ?? flight.registration ?? null,
        gateDeparture: fresh.gateDeparture ?? null,
        gateArrival: fresh.gateArrival ?? null,
        terminalDeparture: fresh.terminalDeparture ?? null,
        terminalArrival: fresh.terminalArrival ?? null,
        baggageClaim: fresh.baggageClaim ?? null,
        departureEstimated: fresh.departureEstimated ?? null,
        departureActual: fresh.departureActual ?? null,
        arrivalEstimated: fresh.arrivalEstimated ?? null,
        arrivalActual: fresh.arrivalActual ?? null,
        takeoffScheduled: fresh.takeoffScheduled ?? null,
        takeoffEstimated: fresh.takeoffEstimated ?? null,
        takeoffActual: fresh.takeoffActual ?? null,
        landingScheduled: fresh.landingScheduled ?? null,
        landingEstimated: fresh.landingEstimated ?? null,
        landingActual: fresh.landingActual ?? null,
        lastPolledAt: new Date(),
      },
    }),
    ...diffs.map((d) =>
      prisma.flightEvent.create({
        data: {
          flightId: flight.id,
          eventType: d.eventType,
          oldValue: d.oldValue,
          newValue: d.newValue,
        },
      })
    ),
  ])

  // Notify via push + WebSocket (only notifiable, deduplicated diffs)
  for (const d of notifiableDiffs) {
    const notif = buildPushNotification(
      d.eventType,
      flight.ident,
      d.oldValue,
      d.newValue,
      flight.origin ?? null,
      flight.destination ?? null,
    )
    const pushPayload = {
      type: 'flight_update',
      flightId: flight.id,
      ident: flight.ident,
      eventType: d.eventType,
      title: notif.title,
      message: notif.body,
    }
    await sendPushToUser(flight.userId, pushPayload)
    await sendPushToShareSubscribers(flight.id, pushPayload)
    wsClients.broadcast(flight.userId, {
      type: 'flight_update',
      flightId: flight.id,
      ident: flight.ident,
      eventType: d.eventType,
      oldValue: d.oldValue,
      newValue: d.newValue,
      title: notif.title,
      message: notif.body,
    })
  }
}

// ── Stub detection helper ────────────────────────────────────────────────

/**
 * Returns true if this flight was saved as a stub (no real AeroDataBox data)
 * and needs enrichment. Stubs have empty or obviously-wrong airport codes.
 * "Obviously wrong" means a 3-letter string that came from text-parsing
 * calendar event body (e.g. "GHT" from "fliGHT", "MIN" from "MINneapolis").
 */
function isStubFlight(flight: Flight): boolean {
  const origin = flight.origin ?? ''
  const dest = flight.destination ?? ''
  // Empty strings = classic stub
  if (origin === '' || dest === '') return true
  // "???" placeholder
  if (origin === '???' || dest === '???') return true
  // Never-polled flights with suspicious codes (lastPolledAt null = fresh stub)
  if (flight.lastPolledAt === null) return true
  return false
}

// ── Fetch helper (one real API call) ─────────────────────────────────────

async function fetchFresh(flight: Flight): Promise<FlightData | null> {
  if (flight.faFlightId) {
    const result = await fetchFlightById(flight.faFlightId)
    if (result) return result
  }
  const dateStr = flight.departureScheduled.toISOString().substring(0, 10)
  return lookupFlight(flight.ident, dateStr)
}

// ── Poll cycle ────────────────────────────────────────────────────────────

async function runPollCycle(): Promise<void> {
  const now = new Date()

  // Budget check — skip ALL real provider calls if over the active provider's
  // monthly free-tier limit (demo mode is always free, never over budget).
  const overBudget = await isActiveProviderOverBudget()
  if (overBudget) {
    console.warn('[poller] Monthly data-provider budget reached — skipping real calls this cycle')
  }

  // Widen upper window slightly so 12h-interval flights (>24h out) still get
  // their periodic heartbeat from within the candidate set.
  const windowStart = new Date(now.getTime() - 24 * 60 * 60 * 1000)
  const windowEnd = new Date(now.getTime() + 48 * 60 * 60 * 1000)

  // Also fetch stubs (empty origin/dest) that are in the future — they need
  // enrichment regardless of the normal polling window.
  const futureStubEnd = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000)

  const [windowCandidates, stubCandidates] = await Promise.all([
    prisma.flight.findMany({
      where: {
        departureScheduled: { gte: windowStart, lte: windowEnd },
        status: { notIn: [...TERMINAL_STATUSES] },
      },
    }),
    prisma.flight.findMany({
      where: {
        departureScheduled: { gte: now, lte: futureStubEnd },
        status: { notIn: [...TERMINAL_STATUSES] },
        OR: [
          { origin: '' },
          { destination: '' },
          { origin: '???' },
          { destination: '???' },
        ],
      },
    }),
  ])

  // Merge, deduplicate by id
  const seenIds = new Set<string>()
  const allCandidates: typeof windowCandidates = []
  for (const f of [...windowCandidates, ...stubCandidates]) {
    if (!seenIds.has(f.id)) {
      seenIds.add(f.id)
      allCandidates.push(f)
    }
  }

  // Filter to flights that are actually due for a poll.
  // Stubs (never polled) are always included.
  const due = allCandidates.filter((f) => {
    if (f.lastPolledAt == null) return true
    if (isStubFlight(f)) {
      // Re-try stubs every hour until enriched
      return now.getTime() - f.lastPolledAt.getTime() >= HOUR_1
    }
    return now.getTime() - f.lastPolledAt.getTime() >= requiredPollIntervalMs(f, now)
  })

  if (due.length === 0) return
  if (overBudget) {
    // Touch lastPolledAt so we don't pile them all up, but don't call API
    // (skip silently — the warning above was already logged)
    return
  }

  // ── Deduplication: group by ident + departure calendar date (UTC) ────────
  // Key: `IDENT::YYYY-MM-DD`
  const buckets = new Map<string, Flight[]>()
  for (const f of due) {
    const dateStr = f.departureScheduled.toISOString().substring(0, 10)
    const key = `${f.ident}::${dateStr}`
    const bucket = buckets.get(key)
    if (bucket) {
      bucket.push(f)
    } else {
      buckets.set(key, [f])
    }
  }

  // Process each bucket: ONE fetch, apply to ALL rows in bucket
  await Promise.allSettled(
    Array.from(buckets.values()).map(async (bucket) => {
      // Use the first flight row as the representative for the fetch
      const representative = bucket[0]
      const fresh = await fetchFresh(representative)
      if (!fresh) return

      // Apply to every flight row in the bucket
      await Promise.allSettled(bucket.map((f) => applyFreshData(f, fresh)))
    })
  )
}

export function startPoller(): void {
  console.log('Starting flight poller (60s wake interval, adaptive per-flight cadence)')
  // Run once immediately
  runPollCycle().catch(console.error)
  setInterval(() => {
    runPollCycle().catch(console.error)
  }, POLL_INTERVAL_MS)
}
