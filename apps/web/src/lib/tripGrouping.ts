import type { Flight, Train } from './api'

export type RiskLevel = 'green' | 'yellow' | 'red'

export interface InlineConnection {
  layoverMinutes: number
  risk: RiskLevel
  airport: string
  sameTerminal: boolean
}

// ─── Leg union type ───────────────────────────────────────────────────────────

export type TripLeg =
  | { legType: 'flight'; data: Flight; sortKey: number }
  | { legType: 'train'; data: Train; sortKey: number }

export function legOrigin(l: TripLeg): string { return l.data.origin }
export function legDestination(l: TripLeg): string { return l.data.destination }
export function legStatus(l: TripLeg): string { return l.data.status }
export function legDeparture(l: TripLeg): string { return l.data.departureScheduled }
export function legId(l: TripLeg): string { return l.data.id }

// ─── Display item types ───────────────────────────────────────────────────────

export interface TripGroupItem {
  type: 'trip'
  tripId: string
  tripName: string
  legs: TripLeg[]
  connections: (InlineConnection | null)[]
  sortKey: number
}

export interface StandaloneFlightItem {
  type: 'standalone'
  flight: Flight
  sortKey: number
}

export interface StandaloneTrainItem {
  type: 'standalone-train'
  train: Train
  sortKey: number
}

// Keep backward compat alias
export type StandaloneItem = StandaloneFlightItem

export type DisplayItem = TripGroupItem | StandaloneFlightItem | StandaloneTrainItem

// ─── Connection helpers ───────────────────────────────────────────────────────

function classifyRisk(minutes: number, sameTerminal: boolean): RiskLevel {
  const redT = sameTerminal ? 30 : 45
  const yellowT = sameTerminal ? 75 : 90
  if (minutes < redT) return 'red'
  if (minutes < yellowT) return 'yellow'
  return 'green'
}

function computeConnectionBetweenLegs(legA: TripLeg, legB: TripLeg): InlineConnection | null {
  if (legDestination(legA) !== legOrigin(legB)) return null

  const arrBest =
    legA.legType === 'flight'
      ? (legA.data.arrivalActual ?? legA.data.arrivalEstimated ?? legA.data.arrivalScheduled)
      : (legA.data.arrivalActual ?? legA.data.arrivalEstimated ?? legA.data.arrivalScheduled)

  const arrivalMs = new Date(arrBest).getTime()
  const departureMs = new Date(legDeparture(legB)).getTime()
  const minutes = Math.round((departureMs - arrivalMs) / 60_000)

  // Terminal info only available for flight–flight connections
  const sameTerminal =
    legA.legType === 'flight' &&
    legB.legType === 'flight' &&
    legA.data.terminalArrival != null &&
    legB.data.terminalDeparture != null &&
    legA.data.terminalArrival === legB.data.terminalDeparture

  return {
    layoverMinutes: minutes,
    risk: classifyRisk(minutes, sameTerminal),
    airport: legDestination(legA),
    sameTerminal,
  }
}

// ─── Build function ───────────────────────────────────────────────────────────

export function buildDisplayItems(flights: Flight[], trains: Train[] = []): DisplayItem[] {
  const tripMap = new Map<string, { legs: TripLeg[]; name: string }>()

  for (const f of flights) {
    if (f.tripId && f.trip) {
      if (!tripMap.has(f.tripId)) tripMap.set(f.tripId, { legs: [], name: f.trip.name })
      tripMap.get(f.tripId)!.legs.push({ legType: 'flight', data: f, sortKey: new Date(f.departureScheduled).getTime() })
    }
  }

  for (const t of trains) {
    if (t.tripId && t.trip) {
      if (!tripMap.has(t.tripId)) tripMap.set(t.tripId, { legs: [], name: t.trip.name })
      tripMap.get(t.tripId)!.legs.push({ legType: 'train', data: t, sortKey: new Date(t.departureScheduled).getTime() })
    }
  }

  const items: DisplayItem[] = []

  for (const [tripId, { legs, name }] of tripMap.entries()) {
    legs.sort((a, b) => a.sortKey - b.sortKey)

    const connections: (InlineConnection | null)[] = []
    for (let i = 0; i < legs.length - 1; i++) {
      connections.push(computeConnectionBetweenLegs(legs[i], legs[i + 1]))
    }

    items.push({
      type: 'trip',
      tripId,
      tripName: name,
      legs,
      connections,
      sortKey: legs[0].sortKey,
    })
  }

  for (const f of flights) {
    if (!f.tripId || !f.trip) {
      items.push({
        type: 'standalone',
        flight: f,
        sortKey: new Date(f.departureScheduled).getTime(),
      })
    }
  }

  for (const t of trains) {
    if (!t.tripId || !t.trip) {
      items.push({
        type: 'standalone-train',
        train: t,
        sortKey: new Date(t.departureScheduled).getTime(),
      })
    }
  }

  items.sort((a, b) => a.sortKey - b.sortKey)
  return items
}
