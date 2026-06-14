import type { Flight } from '@prisma/client'

export interface ConnectionResult {
  flightId: string        // the CONNECTING flight (leg N+1)
  inboundFlightId: string // leg N
  minutesAvailable: number
  risk: 'green' | 'yellow' | 'red'
  arrivalTime: string     // ISO string — updated arrival of leg N
  departureTime: string   // ISO string — scheduled departure of leg N+1
  airport: string         // connection airport IATA
}

/**
 * Classify connection risk.
 *
 * Base thresholds (different terminals):
 *   < 45 min  → 'red'
 *   < 90 min  → 'yellow'
 *   >= 90 min → 'green'
 *
 * Same-terminal bonus: subtract 15 min from all thresholds:
 *   < 30 min  → 'red'
 *   < 75 min  → 'yellow'
 *   >= 75 min → 'green'
 */
export function classifyRisk(minutes: number, sameTerminal = false): 'green' | 'yellow' | 'red' {
  const redThreshold = sameTerminal ? 30 : 45
  const yellowThreshold = sameTerminal ? 75 : 90
  if (minutes < redThreshold) return 'red'
  if (minutes < yellowThreshold) return 'yellow'
  return 'green'
}

export function analyseConnections(flights: Flight[]): ConnectionResult[] {
  // Sort by departure time ascending
  const sorted = [...flights].sort(
    (a, b) => a.departureScheduled.getTime() - b.departureScheduled.getTime()
  )

  const results: ConnectionResult[] = []

  for (let i = 0; i < sorted.length - 1; i++) {
    const legN = sorted[i]
    const legNplus1 = sorted[i + 1]

    // Only consider consecutive legs where the destination of N matches origin of N+1
    if (legN.destination !== legNplus1.origin) continue

    // Best estimate for leg N arrival: actual > estimated > scheduled
    const arrivalTime =
      legN.arrivalActual ??
      legN.arrivalEstimated ??
      legN.arrivalScheduled

    const departureTime = legNplus1.departureScheduled

    const minutesAvailable = Math.round(
      (departureTime.getTime() - arrivalTime.getTime()) / 60_000
    )

    // Same terminal = both terminals are non-null and equal
    const sameTerminal =
      legN.terminalArrival !== null &&
      legNplus1.terminalDeparture !== null &&
      legN.terminalArrival === legNplus1.terminalDeparture

    const risk = classifyRisk(minutesAvailable, sameTerminal)

    results.push({
      flightId: legNplus1.id,
      inboundFlightId: legN.id,
      minutesAvailable,
      risk,
      arrivalTime: arrivalTime.toISOString(),
      departureTime: departureTime.toISOString(),
      airport: legN.destination,
    })
  }

  return results
}
