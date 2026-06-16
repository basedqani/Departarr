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

// Auto-detected connecting itinerary (no manual tripId needed)
export interface AutoItineraryItem {
  type: 'auto-itinerary'
  legs: TripLeg[]
  connections: (InlineConnection | null)[]
  sortKey: number
}

export type DisplayItem = TripGroupItem | StandaloneFlightItem | StandaloneTrainItem | AutoItineraryItem

/** Format a layover duration in minutes as "Xh Ym" */
export function formatLayover(minutes: number): string {
  const absMin = Math.abs(minutes)
  const h = Math.floor(absMin / 60)
  const m = absMin % 60
  if (h === 0) return `${m}m`
  if (m === 0) return `${h}h`
  return `${h}h ${m}m`
}

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

// ─── Auto-itinerary detection ─────────────────────────────────────────────────

// If a flight arrives somewhere and the next departs from the same airport
// within this window it's a connecting itinerary, not separate trips.
const AUTO_GROUP_MAX_GAP_MS = 4 * 60 * 60 * 1000

function buildAutoItineraries(legs: TripLeg[]): { grouped: AutoItineraryItem[]; remaining: TripLeg[] } {
  const sorted = [...legs].sort((a, b) => a.sortKey - b.sortKey)
  // `used` tracks only indices that actually became part of a multi-leg chain.
  // A chain-start index is NOT marked used unless its chain reaches length >= 2,
  // otherwise lone standalone legs would be excluded from both `grouped` and
  // `remaining` and vanish from the UI entirely.
  const used = new Set<number>()
  const grouped: AutoItineraryItem[] = []

  for (let i = 0; i < sorted.length; i++) {
    if (used.has(i)) continue
    const chainIdx: number[] = [i]
    let last = sorted[i]

    for (let j = i + 1; j < sorted.length; j++) {
      if (used.has(j)) continue
      const next = sorted[j]
      if (legDestination(last) !== legOrigin(next)) continue
      const arrBest = last.legType === 'flight'
        ? (last.data.arrivalActual ?? last.data.arrivalEstimated ?? last.data.arrivalScheduled)
        : (last.data.arrivalActual ?? last.data.arrivalEstimated ?? last.data.arrivalScheduled)
      const gap = new Date(legDeparture(next)).getTime() - new Date(arrBest).getTime()
      if (gap >= 0 && gap <= AUTO_GROUP_MAX_GAP_MS) {
        chainIdx.push(j)
        last = next
      }
    }

    if (chainIdx.length >= 2) {
      // Only now mark every member consumed, so they're excluded from remaining.
      for (const idx of chainIdx) used.add(idx)
      const chain = chainIdx.map(idx => sorted[idx])
      const connections: (InlineConnection | null)[] = []
      for (let k = 0; k < chain.length - 1; k++) {
        connections.push(computeConnectionBetweenLegs(chain[k], chain[k + 1]))
      }
      grouped.push({ type: 'auto-itinerary', legs: chain, connections, sortKey: chain[0].sortKey })
    }
  }

  const remaining = sorted.filter((_, idx) => !used.has(idx))
  return { grouped, remaining }
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

  // Collect all standalone legs, run auto-grouping, then add the remainder individually
  const standaloneLegs: TripLeg[] = []
  for (const f of flights) {
    if (!f.tripId || !f.trip) {
      standaloneLegs.push({ legType: 'flight', data: f, sortKey: new Date(f.departureScheduled).getTime() })
    }
  }
  for (const t of trains) {
    if (!t.tripId || !t.trip) {
      standaloneLegs.push({ legType: 'train', data: t, sortKey: new Date(t.departureScheduled).getTime() })
    }
  }

  const { grouped: autoGroups, remaining } = buildAutoItineraries(standaloneLegs)
  items.push(...autoGroups)

  for (const leg of remaining) {
    if (leg.legType === 'flight') {
      items.push({ type: 'standalone', flight: leg.data, sortKey: leg.sortKey })
    } else {
      items.push({ type: 'standalone-train', train: leg.data, sortKey: leg.sortKey })
    }
  }

  items.sort((a, b) => a.sortKey - b.sortKey)
  return items
}
