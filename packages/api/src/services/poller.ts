import { prisma } from '../lib/prisma.js'
import { fetchFlightById, lookupFlight, type FlightData } from './flightAware.js'
import { sendPushToUser, buildPushMessage } from './webPush.js'
import { wsClients } from '../lib/wsClients.js'
import type { Flight } from '@prisma/client'

const POLL_INTERVAL_MS = 60_000
const TERMINAL_STATUSES = new Set(['arrived', 'cancelled', 'diverted'])

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
  check('takeoffActual', 'departure', stored.takeoffActual, fresh.takeoffActual)
  check('landingEstimated', 'delay', stored.landingEstimated, fresh.landingEstimated)
  check('landingActual', 'arrival', stored.landingActual, fresh.landingActual)

  // Cancellation
  if (fresh.status === 'cancelled' && stored.status !== 'cancelled') {
    diffs.push({ field: 'status', eventType: 'cancellation', oldValue: stored.status, newValue: 'cancelled' })
  }

  return diffs
}

async function pollFlight(flight: Flight): Promise<void> {
  let fresh: FlightData | null = null

  if (flight.faFlightId) {
    fresh = await fetchFlightById(flight.faFlightId)
  }
  if (!fresh) {
    const dateStr = flight.departureScheduled.toISOString().substring(0, 10)
    fresh = await lookupFlight(flight.ident, dateStr)
  }
  if (!fresh) return

  const diffs = diffFlights(flight, fresh)

  if (diffs.length === 0) {
    await prisma.flight.update({ where: { id: flight.id }, data: { lastPolledAt: new Date() } })
    return
  }

  // Write events
  await prisma.$transaction([
    prisma.flight.update({
      where: { id: flight.id },
      data: {
        status: fresh.status,
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

  // Notify via push + WebSocket
  for (const d of diffs) {
    const msg = buildPushMessage(d.eventType, d.oldValue, d.newValue)
    await sendPushToUser(flight.userId, {
      type: 'flight_update',
      flightId: flight.id,
      ident: flight.ident,
      eventType: d.eventType,
      message: msg,
    })
    wsClients.broadcast(flight.userId, {
      type: 'flight_update',
      flightId: flight.id,
      ident: flight.ident,
      eventType: d.eventType,
      oldValue: d.oldValue,
      newValue: d.newValue,
      message: msg,
    })
  }
}

async function runPollCycle(): Promise<void> {
  const now = new Date()
  const windowStart = new Date(now.getTime() - 24 * 60 * 60 * 1000)
  const windowEnd = new Date(now.getTime() + 48 * 60 * 60 * 1000)

  const flights = await prisma.flight.findMany({
    where: {
      departureScheduled: { gte: windowStart, lte: windowEnd },
      status: { notIn: [...TERMINAL_STATUSES] },
    },
  })

  await Promise.allSettled(flights.map(pollFlight))
}

export function startPoller(): void {
  console.log('Starting flight poller (60s interval)')
  // Run once immediately
  runPollCycle().catch(console.error)
  setInterval(() => {
    runPollCycle().catch(console.error)
  }, POLL_INTERVAL_MS)
}
