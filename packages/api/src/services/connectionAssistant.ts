/**
 * Connection Assistant — Technical Spec
 * ======================================
 * Analyses consecutive flight pairs within a trip and surfaces connection risk,
 * mirroring the kind of "tight connection" warnings Flighty shows. This file
 * contains only type definitions and function stubs; the actual implementation
 * lives here once built.
 *
 * API shape (once wired into the router):
 *   GET /api/trips/:id/connections
 *   → ConnectionResult[]
 */

// ─── Data model ───────────────────────────────────────────────────────────────

/**
 * A single flight leg as stored in the DB (Prisma Flight model subset).
 * The connection assistant only needs these fields; the caller should pass the
 * full Trip with its flights pre-loaded (Trip.flights).
 */
export interface ConnectionFlight {
  id: string
  ident: string                  // e.g. "UA 123"
  origin: string                 // IATA, e.g. "ORD"
  destination: string            // IATA, e.g. "FRA"
  departureScheduled: string     // ISO-8601 UTC
  departureEstimated: string | null
  departureActual: string | null
  arrivalScheduled: string       // ISO-8601 UTC
  arrivalEstimated: string | null
  arrivalActual: string | null
  terminalDeparture: string | null   // e.g. "B"
  terminalArrival: string | null     // e.g. "B"
}

/**
 * Risk level for a connection window:
 *   red    — critically short, likely to miss
 *   yellow — tight but potentially feasible
 *   green  — comfortable
 *
 * Thresholds (before same-terminal bonus):
 *   International (arrivalAirport != departureAirport domestic pair):
 *     red    < 45 min
 *     yellow < 90 min
 *     green  >= 90 min
 *   Domestic / same-terminal:
 *     apply a −15 min bonus to all thresholds
 *     red    < 30 min
 *     yellow < 75 min
 *     green  >= 75 min
 *
 * "Same terminal" = arrivalTerminal[n] === departureTerminal[n+1] AND both are
 * non-null. The −15 min bonus reflects skipping an inter-terminal transit.
 */
export type ConnectionRisk = 'red' | 'yellow' | 'green'

/**
 * Result object returned for each detected connection pair.
 */
export interface ConnectionResult {
  /** The inbound flight that arrives at the layover airport. */
  flightA: ConnectionFlight
  /** The outbound flight that departs from the same layover airport. */
  flightB: ConnectionFlight
  /**
   * The IATA code of the layover (connection) airport.
   * Invariant: flightA.destination === flightB.origin === layoverAirport
   */
  layoverAirport: string
  /**
   * Effective connection window in minutes.
   * = departureEffective(flightB) − arrivalEffective(flightA)
   * where:
   *   arrivalEffective  = arrivalActual ?? arrivalEstimated ?? arrivalScheduled
   *   departureEffective = departureEstimated ?? departureScheduled
   * Can be negative if the inbound is severely delayed past the outbound.
   */
  windowMinutes: number
  /** Whether the inbound terminal matches the outbound terminal (non-null match). */
  sameTerminal: boolean
  /** Computed risk level after applying the same-terminal bonus. */
  risk: ConnectionRisk
  /**
   * How many minutes the inbound is delayed vs its scheduled arrival.
   * 0 if on time or early.
   */
  inboundDelayMinutes: number
}

// ─── Detection logic ──────────────────────────────────────────────────────────

/**
 * For each consecutive pair of flights in the trip where
 *   flightA.destination === flightB.origin
 * compute the connection result.
 *
 * Pairs are identified by sorting flights by their effective departure time and
 * then scanning adjacent legs. A trip of N flights can produce up to N−1
 * connection results.
 *
 * @param flights - All flights in the trip, in any order. The function sorts
 *                  them internally by departureScheduled.
 * @returns Array of ConnectionResult, one per detected connection. Empty if
 *          the trip has fewer than 2 flights or no consecutive airport matches.
 */
export function analyseConnections(flights: ConnectionFlight[]): ConnectionResult[] {
  // TODO:
  // 1. Sort flights by departureScheduled ASC.
  // 2. Walk pairs (flights[i], flights[i+1]).
  // 3. Skip pairs where flights[i].destination !== flights[i+1].origin.
  // 4. For matching pairs, call computeConnectionResult(flightA, flightB).
  // 5. Return the array.
  throw new Error('Not implemented')
}

/**
 * Compute a single ConnectionResult for a known inbound/outbound pair.
 *
 * Algorithm:
 *   arrivalEffective  = flightA.arrivalActual ?? flightA.arrivalEstimated ?? flightA.arrivalScheduled
 *   departureEffective = flightB.departureEstimated ?? flightB.departureScheduled
 *   windowMinutes = (departureEffective − arrivalEffective) / 60_000   [convert ms → min]
 *   inboundDelayMinutes = max(0, (arrivalEffective − flightA.arrivalScheduled) / 60_000)
 *   sameTerminal = flightA.terminalArrival !== null
 *                  && flightB.terminalDeparture !== null
 *                  && flightA.terminalArrival === flightB.terminalDeparture
 *   risk = classifyRisk(windowMinutes, sameTerminal)
 */
export function computeConnectionResult(
  flightA: ConnectionFlight,
  flightB: ConnectionFlight,
): ConnectionResult {
  // TODO: implement per the algorithm above.
  throw new Error('Not implemented')
}

/**
 * Classify connection risk given a window and terminal situation.
 *
 * Base thresholds (international / different terminals):
 *   < 45 min  → 'red'
 *   < 90 min  → 'yellow'
 *   >= 90 min → 'green'
 *
 * Same-terminal bonus: subtract 15 min from all thresholds, effectively:
 *   < 30 min  → 'red'
 *   < 75 min  → 'yellow'
 *   >= 75 min → 'green'
 *
 * A negative windowMinutes always returns 'red' (connection already missed or
 * impossible).
 */
export function classifyRisk(windowMinutes: number, sameTerminal: boolean): ConnectionRisk {
  // TODO: implement per the thresholds above.
  throw new Error('Not implemented')
}

// ─── Push notification trigger ────────────────────────────────────────────────

/**
 * Called by the flight poller (packages/api/src/services/poller.ts) whenever
 * arrivalEstimated updates for a flight that is part of a trip.
 *
 * Behaviour:
 * 1. Re-run analyseConnections for the trip.
 * 2. For each connection where the NEW risk is 'red' and the PREVIOUS risk was
 *    NOT 'red' (i.e. it just crossed the threshold), fire a push notification
 *    to all push subscriptions associated with the trip's owner.
 * 3. Notification payload:
 *    title: "Tight connection at {layoverAirport}"
 *    body:  "Only {windowMinutes}m to connect {flightA.ident} → {flightB.ident}"
 *    url:   "/flights/{flightB.id}"
 *
 * The previousRisk map should be persisted between poller ticks (in-memory Map
 * keyed by `${flightA.id}:${flightB.id}` is fine for a single-process server;
 * a Redis key works for multi-instance deployments).
 *
 * @param tripId - The trip to re-evaluate.
 * @param updatedFlightId - The flight whose arrivalEstimated just changed.
 * @param previousRiskMap - Mutable map of pair-key → last known risk, updated
 *                          in-place by this function.
 */
export async function checkAndNotifyConnectionRisk(
  tripId: string,
  updatedFlightId: string,
  previousRiskMap: Map<string, ConnectionRisk>,
): Promise<void> {
  // TODO:
  // 1. Load the Trip (with flights) from the DB using tripId.
  // 2. analyseConnections(trip.flights).
  // 3. For each ConnectionResult:
  //    a. Build key = `${result.flightA.id}:${result.flightB.id}`.
  //    b. Read previousRisk = previousRiskMap.get(key) ?? 'green'.
  //    c. If result.risk === 'red' && previousRisk !== 'red': send push.
  //    d. previousRiskMap.set(key, result.risk).
  throw new Error('Not implemented')
}

// ─── Router handler stub ──────────────────────────────────────────────────────

/**
 * Express/Hono handler for GET /api/trips/:id/connections
 *
 * Response shape: ConnectionResult[]
 *
 * Error cases:
 *   404 if the trip does not exist or does not belong to the authenticated user.
 *   200 with [] if the trip has no connections (single-leg trip).
 *
 * Example response:
 * [
 *   {
 *     "flightA": { "id": "...", "ident": "AA 100", "origin": "JFK", "destination": "ORD", ... },
 *     "flightB": { "id": "...", "ident": "AA 200", "origin": "ORD", "destination": "LAX", ... },
 *     "layoverAirport": "ORD",
 *     "windowMinutes": 52,
 *     "sameTerminal": true,
 *     "risk": "yellow",
 *     "inboundDelayMinutes": 18
 *   }
 * ]
 */
export async function handleGetTripConnections(
  tripId: string,
  userId: string,
): Promise<ConnectionResult[]> {
  // TODO:
  // 1. Fetch trip from DB, verify ownership (throw 404 if not found / wrong user).
  // 2. Call analyseConnections(trip.flights).
  // 3. Return the array (serialised as JSON by the router).
  throw new Error('Not implemented')
}
