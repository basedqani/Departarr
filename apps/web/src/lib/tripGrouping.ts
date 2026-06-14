import type { Flight } from './api'

export type RiskLevel = 'green' | 'yellow' | 'red'

export interface InlineConnection {
  layoverMinutes: number
  risk: RiskLevel
  airport: string
  sameTerminal: boolean
}

export interface TripGroupItem {
  type: 'trip'
  tripId: string
  tripName: string
  legs: Flight[]
  connections: (InlineConnection | null)[]
  sortKey: number
}

export interface StandaloneItem {
  type: 'standalone'
  flight: Flight
  sortKey: number
}

export type DisplayItem = TripGroupItem | StandaloneItem

function classifyRisk(minutes: number, sameTerminal: boolean): RiskLevel {
  const redT = sameTerminal ? 30 : 45
  const yellowT = sameTerminal ? 75 : 90
  if (minutes < redT) return 'red'
  if (minutes < yellowT) return 'yellow'
  return 'green'
}

function computeConnection(legN: Flight, legNplus1: Flight): InlineConnection | null {
  if (legN.destination !== legNplus1.origin) return null
  const arrivalMs = new Date(
    (legN.arrivalActual ?? legN.arrivalEstimated ?? legN.arrivalScheduled) as string
  ).getTime()
  const departureMs = new Date(legNplus1.departureScheduled).getTime()
  const minutes = Math.round((departureMs - arrivalMs) / 60_000)
  const sameTerminal =
    legN.terminalArrival != null &&
    legNplus1.terminalDeparture != null &&
    legN.terminalArrival === legNplus1.terminalDeparture
  return {
    layoverMinutes: minutes,
    risk: classifyRisk(minutes, sameTerminal),
    airport: legN.destination,
    sameTerminal,
  }
}

export function buildDisplayItems(flights: Flight[]): DisplayItem[] {
  const tripMap = new Map<string, Flight[]>()
  const standalone: Flight[] = []

  for (const f of flights) {
    if (f.tripId && f.trip) {
      if (!tripMap.has(f.tripId)) tripMap.set(f.tripId, [])
      tripMap.get(f.tripId)!.push(f)
    } else {
      standalone.push(f)
    }
  }

  const items: DisplayItem[] = []

  for (const [tripId, legs] of tripMap.entries()) {
    legs.sort(
      (a, b) =>
        new Date(a.departureScheduled).getTime() - new Date(b.departureScheduled).getTime()
    )
    const connections: (InlineConnection | null)[] = []
    for (let i = 0; i < legs.length - 1; i++) {
      connections.push(computeConnection(legs[i], legs[i + 1]))
    }
    items.push({
      type: 'trip',
      tripId,
      tripName: legs[0].trip!.name,
      legs,
      connections,
      sortKey: new Date(legs[0].departureScheduled).getTime(),
    })
  }

  for (const f of standalone) {
    items.push({
      type: 'standalone',
      flight: f,
      sortKey: new Date(f.departureScheduled).getTime(),
    })
  }

  items.sort((a, b) => a.sortKey - b.sortKey)
  return items
}
