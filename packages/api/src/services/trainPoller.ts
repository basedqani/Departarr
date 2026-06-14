/**
 * Train poller — mirrors poller.ts for flights.
 *
 * Polls Amtraker for trains that are active or departing within 24h.
 * Adaptive cadence: 15 min when en-route/at-station, 30 min pre-departure.
 * Sends push + WebSocket notifications on status changes and significant delays.
 */

import { prisma } from '../lib/prisma.js'
import { fetchLiveTrainStatus } from './amtraker.js'
import { sendPushToUser } from './webPush.js'
import { wsClients } from '../lib/wsClients.js'
import type { Train } from '@prisma/client'

const POLL_INTERVAL_MS = 60_000
const TERMINAL_STATUSES = new Set(['arrived', 'cancelled'])
const MIN_15 = 15 * 60 * 1000
const MIN_30 = 30 * 60 * 1000
const HOUR_12 = 12 * 60 * 60 * 1000

// ── Cadence ───────────────────────────────────────────────────────────────

export function requiredTrainPollIntervalMs(train: Train, now: Date): number {
  const status = train.status.toLowerCase()

  // Active: poll frequently
  if (status === 'en-route' || status === 'at-station') {
    return MIN_15
  }

  const depTime = (train.departureEstimated ?? train.departureScheduled).getTime()
  const msTilDep = depTime - now.getTime()

  if (msTilDep <= 0) return MIN_30          // past scheduled dep, not captured
  if (msTilDep <= 3 * 60 * 60 * 1000) return MIN_15   // within 3h
  if (msTilDep <= 6 * 60 * 60 * 1000) return MIN_30   // within 6h
  return HOUR_12                            // >6h out — check infrequently
}

// ── Diff helpers ──────────────────────────────────────────────────────────

interface TrainDiff {
  field: string
  eventType: string
  oldValue: string | null
  newValue: string | null
}

function diffTrains(stored: Train, fresh: {
  status: string
  departureEstimated: Date | null
  arrivalEstimated: Date | null
  departureActual: Date | null
  arrivalActual: Date | null
  stopsJson?: string | null
}): TrainDiff[] {
  const diffs: TrainDiff[] = []

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
  check('departureEstimated', 'delay', stored.departureEstimated, fresh.departureEstimated)
  check('departureActual', 'departure', stored.departureActual, fresh.departureActual)
  check('arrivalEstimated', 'delay', stored.arrivalEstimated, fresh.arrivalEstimated)
  check('arrivalActual', 'arrival', stored.arrivalActual, fresh.arrivalActual)

  // Stops changed (new live stop info)
  if (fresh.stopsJson && fresh.stopsJson !== stored.stopsJson) {
    diffs.push({
      field: 'stopsJson',
      eventType: 'stops_update',
      oldValue: null,
      newValue: fresh.stopsJson,
    })
  }

  return diffs
}

// ── Push notification copy ────────────────────────────────────────────────

function buildTrainNotification(
  eventType: string,
  trainNumber: string,
  trainName: string | null,
  oldValue: string | null,
  newValue: string | null,
  origin: string,
  destination: string
): { title: string; body: string } {
  const label = trainName ? `Train ${trainNumber} · ${trainName}` : `Train ${trainNumber}`

  switch (eventType) {
    case 'status_change': {
      if (newValue === 'en-route') {
        return { title: `${label} — Departed`, body: `Departed ${origin}, en route to ${destination}` }
      }
      if (newValue === 'at-station') {
        return { title: `${label} — At station`, body: `Stopped at an intermediate station` }
      }
      if (newValue === 'arrived') {
        return { title: `${label} — Arrived`, body: `Arrived at ${destination}` }
      }
      return { title: `${label}`, body: `Status: ${newValue}` }
    }
    case 'departure': {
      return { title: `${label} — Departed`, body: `Departed ${origin}` }
    }
    case 'arrival': {
      return { title: `${label} — Arrived`, body: `Arrived at ${destination}` }
    }
    case 'delay': {
      // Try to format a readable time
      if (newValue) {
        try {
          const d = new Date(newValue)
          const timeStr = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })
          return { title: `${label} — Delay update`, body: `Now estimated ${timeStr}` }
        } catch {
          // fall through
        }
      }
      return { title: `${label} — Delay update`, body: `Schedule has changed` }
    }
    default:
      return { title: label, body: `Update: ${eventType}` }
  }
}

// ── Per-train apply ───────────────────────────────────────────────────────

async function applyFreshData(
  train: Train,
  fresh: {
    status: string
    departureEstimated: Date | null
    arrivalEstimated: Date | null
    departureActual: Date | null
    arrivalActual: Date | null
    stopsJson?: string | null
  }
): Promise<void> {
  // First poll — silent baseline
  if (train.lastPolledAt === null) {
    await prisma.train.update({
      where: { id: train.id },
      data: {
        status: fresh.status,
        departureEstimated: fresh.departureEstimated,
        departureActual: fresh.departureActual,
        arrivalEstimated: fresh.arrivalEstimated,
        arrivalActual: fresh.arrivalActual,
        stopsJson: fresh.stopsJson ?? train.stopsJson,
        lastPolledAt: new Date(),
      },
    })
    return
  }

  const diffs = diffTrains(train, fresh)

  if (diffs.length === 0) {
    await prisma.train.update({ where: { id: train.id }, data: { lastPolledAt: new Date() } })
    return
  }

  // Dedup by eventType
  const seen = new Set<string>()
  const uniqueDiffs = diffs.filter(d => {
    if (seen.has(d.eventType)) return false
    seen.add(d.eventType)
    return true
  })

  // Suppress departure delays once departed
  const alreadyDeparted = train.departureActual != null || fresh.status === 'en-route' || fresh.status === 'arrived'
  const notifiableDiffs = uniqueDiffs.filter(d => {
    if (alreadyDeparted && d.eventType === 'delay' && d.field === 'departureEstimated') return false
    if (d.eventType === 'stops_update') return false // don't push for stops changes
    return true
  })

  // Write to DB
  await prisma.$transaction([
    prisma.train.update({
      where: { id: train.id },
      data: {
        status: fresh.status,
        departureEstimated: fresh.departureEstimated,
        departureActual: fresh.departureActual,
        arrivalEstimated: fresh.arrivalEstimated,
        arrivalActual: fresh.arrivalActual,
        stopsJson: fresh.stopsJson ?? train.stopsJson,
        lastPolledAt: new Date(),
      },
    }),
    ...diffs
      .filter(d => d.eventType !== 'stops_update') // don't log stops in events table
      .map(d =>
        prisma.trainEvent.create({
          data: {
            trainId: train.id,
            eventType: d.eventType,
            oldValue: d.oldValue,
            newValue: d.newValue,
          },
        })
      ),
  ])

  // Notify
  for (const d of notifiableDiffs) {
    const notif = buildTrainNotification(
      d.eventType,
      train.trainNumber,
      train.trainName,
      d.oldValue,
      d.newValue,
      train.origin,
      train.destination,
    )
    const pushPayload = {
      type: 'train_update',
      trainId: train.id,
      trainNumber: train.trainNumber,
      eventType: d.eventType,
      title: notif.title,
      message: notif.body,
    }
    await sendPushToUser(train.userId, pushPayload)
    wsClients.broadcast(train.userId, {
      type: 'train_update',
      trainId: train.id,
      trainNumber: train.trainNumber,
      eventType: d.eventType,
      oldValue: d.oldValue,
      newValue: d.newValue,
      title: notif.title,
      message: notif.body,
    })
  }
}

// ── Poll cycle ────────────────────────────────────────────────────────────

async function runTrainPollCycle(): Promise<void> {
  const now = new Date()
  const windowStart = new Date(now.getTime() - 24 * 60 * 60 * 1000) // 24h ago
  const windowEnd = new Date(now.getTime() + 48 * 60 * 60 * 1000)   // 48h ahead

  const candidates = await prisma.train.findMany({
    where: {
      OR: [
        // Trains departing in the next 24h or arrived in last 24h
        { departureScheduled: { gte: windowStart, lte: windowEnd } },
        // Active trains
        { status: { in: ['en-route', 'at-station'] } },
      ],
      status: { notIn: [...TERMINAL_STATUSES] },
    },
  })

  const due = candidates.filter(t => {
    if (t.lastPolledAt == null) return true
    return now.getTime() - t.lastPolledAt.getTime() >= requiredTrainPollIntervalMs(t, now)
  })

  if (due.length === 0) return

  await Promise.allSettled(
    due.map(async (train) => {
      try {
        const live = await fetchLiveTrainStatus(train.trainNumber, train.origin)
        if (!live) return

        const stopsJson = live.stops.length > 0 ? JSON.stringify(live.stops) : undefined

        await applyFreshData(train, {
          status: live.status,
          departureEstimated: live.departureEstimated,
          arrivalEstimated: live.arrivalEstimated,
          departureActual: live.departureActual,
          arrivalActual: live.arrivalActual,
          stopsJson: stopsJson ?? null,
        })
      } catch (err) {
        console.error(`[trainPoller] Error polling train ${train.trainNumber} (${train.id}):`, err)
      }
    })
  )
}

export function startTrainPoller(): void {
  console.log('Starting train poller (60s wake interval, adaptive per-train cadence)')
  runTrainPollCycle().catch(console.error)
  setInterval(() => {
    runTrainPollCycle().catch(console.error)
  }, POLL_INTERVAL_MS)
}
