/**
 * Dual-engine tracking orchestrator.
 *
 * Runs every 30 seconds alongside poller.ts. Implements a 4-phase state machine
 * that orchestrates free ADSB.lol transponder data and paid FlightAware gate
 * enrichment calls.
 *
 * Phases:
 *   SCHEDULED   — > 3h before departure, do nothing
 *   IN_TERMINAL — within 3h of departure, poll ADSB every 60s for liftoff
 *   EN_ROUTE    — airborne; shared flights get ETA deviation tracking, private sleep
 *   ARRIVING    — within 20min of ETA, poll ADSB every 30s for touchdown
 *   ARRIVED     — landed, enriched, removed from map
 */

import { prisma } from '../lib/prisma.js'
import { getAdsbPosition, haversineKm, isTaxiingOrRolling, hasLiftedOff, isLandedSample } from './adsbLol.js'
import { fetchGateEnrichment, hasFlightAwareKey, isMockMode } from './flightAwareGates.js'
import { isActiveProviderOverBudget } from './flightAware.js'
import { normalizeStatus } from '../lib/flightStatus.js'

// ── Airport coordinate lookup ────────────────────────────────────────────────
// [lat, lon] for top-30 US airports + common internationals

const AIRPORT_COORDS: Record<string, [number, number]> = {
  ORD: [41.9742, -87.9073],
  LAX: [33.9425, -118.4081],
  JFK: [40.6413, -73.7781],
  ATL: [33.6407, -84.4277],
  DFW: [32.8998, -97.0403],
  DEN: [39.8561, -104.6737],
  SFO: [37.6213, -122.379],
  SEA: [47.4502, -122.3088],
  BOS: [42.3656, -71.0096],
  MIA: [25.7959, -80.287],
  PHX: [33.4373, -112.0078],
  LAS: [36.084, -115.1537],
  MSP: [44.8848, -93.2223],
  DTW: [42.2162, -83.3554],
  CLT: [35.214, -80.9431],
  EWR: [40.6895, -74.1745],
  SLC: [40.7884, -111.9778],
  IAH: [29.9902, -95.3368],
  MCO: [28.4312, -81.3081],
  PHL: [39.8744, -75.2424],
  BWI: [39.1754, -76.6682],
  DCA: [38.8521, -77.0377],
  TPA: [27.9755, -82.5332],
  SAN: [32.7338, -117.1933],
  PDX: [45.5898, -122.5951],
  OAK: [37.7213, -122.2208],
  SJC: [37.3626, -121.929],
  HNL: [21.3245, -157.9251],
  ANC: [61.1743, -149.9963],
  HOU: [29.6454, -95.2789],
  // Common internationals
  LHR: [51.477, -0.4613],
  CDG: [49.0097, 2.5479],
  NRT: [35.7653, 140.3858],
  YYZ: [43.6777, -79.6248],
  CUN: [21.0365, -86.8771],
  MEX: [19.4363, -99.0721],
  GRU: [-23.4356, -46.4731],
  SYD: [-33.9399, 151.1753],
  DXB: [25.2532, 55.3657],
  FRA: [50.0379, 8.5622],
  AMS: [52.3105, 4.7683],
  MAD: [40.4983, -3.5676],
  BCN: [41.2971, 2.0785],
  FCO: [41.8003, 12.2389],
  MUC: [48.3538, 11.7861],
}

function getAirportCoords(iata: string): [number, number] | null {
  return AIRPORT_COORDS[iata.toUpperCase()] ?? null
}

// ── Phase state ──────────────────────────────────────────────────────────────

type TrackingPhase =
  | 'SCHEDULED'
  | 'IN_TERMINAL'
  | 'EN_ROUTE'
  | 'ARRIVING'
  | 'ARRIVED'

interface PhaseState {
  flightId: string
  phase: TrackingPhase
  isShared: boolean
  isSharedChecked: boolean    // DE-12: whether isShared was resolved this lifecycle
  lastAdsbPoll: number       // timestamp ms
  lastEnrichment: number     // timestamp ms
  enrichmentCount: number    // total FA enrichment calls this flight
  baselineEtaMs: number      // original scheduled/estimated arrival as ms
  wakeAt: number | null      // for EN_ROUTE sleep — when to wake
  groundConfirmations: number // DE-7: consecutive on-ground+proximate samples
}

// In-memory state map; keyed by flight DB id
const phaseMap = new Map<string, PhaseState>()

// ── Constants ────────────────────────────────────────────────────────────────

const LOOP_INTERVAL_MS       = 30_000
const ADSB_TERMINAL_MS       = 60_000   // IN_TERMINAL: poll every 60s
const ADSB_EN_ROUTE_MS       = 120_000  // EN_ROUTE shared: poll every 2min
const ADSB_ARRIVING_MS       = 30_000   // ARRIVING: poll every 30s
const THREE_HOURS_MS         = 3 * 60 * 60 * 1000
const TWENTY_MIN_MS          = 20 * 60 * 1000
const TWELVE_HOURS_MS        = 12 * 60 * 60 * 1000
const ETA_DEVIATION_MS       = 15 * 60 * 1000  // 15-minute threshold
const MAX_ENRICHMENTS        = 3
const LANDING_PROXIMITY_KM   = 5    // DE-7: must be within 5km of dest coords
const LANDING_CONFIRMATIONS  = 2    // DE-7: consecutive on-ground samples needed

const TERMINAL_STATUSES = new Set([
  'arrived', 'cancelled', 'diverted',
])

// ── faFlightId resolution (DE-8) ───────────────────────────────────────────────

/** Format a Date as YYYYMMDD (UTC) for the ident/date AeroAPI fallback. */
function formatIdentDate(d: Date): string {
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}${m}${day}`
}

/**
 * DE-8: When faFlightId is null, pass `IDENT/YYYYMMDD` (date from
 * departureScheduled) to fetchGateEnrichment so we hit the right-day leg,
 * not a bare ident that resolves to whatever leg AeroAPI returns first.
 */
function resolveEnrichmentId(flight: {
  faFlightId: string | null
  ident: string
  departureScheduled: Date
}): string {
  if (flight.faFlightId) return flight.faFlightId
  return `${flight.ident}/${formatIdentDate(flight.departureScheduled)}`
}

// ── Budget guard ─────────────────────────────────────────────────────────────

/**
 * @param reserveForArrival DE-10: when true, leave the final enrichment slot
 *        free for the guaranteed arrival call (cap at MAX-1).
 */
async function canEnrich(state: PhaseState, reserveForArrival = false): Promise<boolean> {
  const cap = reserveForArrival ? MAX_ENRICHMENTS - 1 : MAX_ENRICHMENTS
  if (state.enrichmentCount >= cap) {
    console.log(`[orchestrator] Flight ${state.flightId} enrichment cap reached (${cap})`)
    return false
  }
  if (await isMockMode()) return true  // mock calls are free
  if (!(await hasFlightAwareKey())) return false
  if (await isActiveProviderOverBudget()) {
    console.log(`[orchestrator] Provider over budget — skipping enrichment for flight ${state.flightId}`)
    return false
  }
  return true
}

// ── Phase-state persistence (DE-6) ─────────────────────────────────────────────
// The in-memory phaseMap is wiped on every restart, which used to reset the
// enrichment cap and re-arm sleeps. Persist phase + enrichmentCount + wakeAt to
// the DB so restarts resume where we left off.

async function persistState(state: PhaseState): Promise<void> {
  try {
    await prisma.flight.update({
      where: { id: state.flightId },
      data: {
        trackingPhase: state.phase,
        enrichmentCount: state.enrichmentCount,
        wakeAt: state.wakeAt != null ? new Date(state.wakeAt) : null,
      },
    })
  } catch (err) {
    console.error(`[orchestrator] Failed to persist phase state for ${state.flightId}:`, err)
  }
}

// ── ADSB lookup helper ────────────────────────────────────────────────────────

async function pollAdsb(flight: { registration: string | null; icaoHex: string | null; ident: string }) {
  const reg = flight.registration ?? ''
  // Prefer the dedicated icaoHex column; else detect a 6-hex registration value.
  const regIsHex = /^[0-9a-fA-F]{6}$/.test(reg)
  const icaoHex = flight.icaoHex || (regIsHex ? reg : null)
  return getAdsbPosition({
    icaoHex,
    registration: !regIsHex && reg ? reg : null,
    callsign: flight.ident,
  })
}

// ── Determine phase from flight data + current state ─────────────────────────

function computePhase(
  flight: {
    departureScheduled: Date
    takeoffActual: Date | null
    arrivalActual: Date | null
    arrivalEstimated: Date | null
    arrivalScheduled: Date
    status: string
  },
  now: number,
): TrackingPhase {
  const depMs = flight.departureScheduled.getTime()
  const msTilDep = depMs - now

  // Already has a landing/arrival recorded
  if (flight.arrivalActual) return 'ARRIVED'

  // Airborne (wheels off)
  if (flight.takeoffActual) {
    const etaMs = (flight.arrivalEstimated ?? flight.arrivalScheduled).getTime()
    if (now >= etaMs - TWENTY_MIN_MS) return 'ARRIVING'
    return 'EN_ROUTE'
  }

  // Pre-departure
  if (msTilDep > THREE_HOURS_MS) return 'SCHEDULED'
  return 'IN_TERMINAL'
}

// ── Per-flight orchestration ──────────────────────────────────────────────────

interface OrchestratorFlight {
  id: string
  ident: string
  registration: string | null
  icaoHex: string | null
  faFlightId: string | null
  departureScheduled: Date
  takeoffActual: Date | null
  arrivalActual: Date | null
  arrivalEstimated: Date | null
  arrivalScheduled: Date
  destination: string | null
  status: string
  lastPolledAt: Date | null
  // Persisted phase state (DE-6)
  trackingPhase: string | null
  enrichmentCount: number
  wakeAt: Date | null
}

async function processFlight(flight: OrchestratorFlight): Promise<void> {
  const now = Date.now()

  // Skip flights not yet initialized by poller
  if (!flight.lastPolledAt) return

  // DE-11: never make real ADSB/FA HTTP calls for stub/demo/mock flights.
  const fid = flight.faFlightId ?? ''
  if (fid.startsWith('STUB-') || fid.startsWith('ADB:') || /mock/i.test(fid)) return

  const computedPhase = computePhase(flight, now)

  // Get or initialize state. On a cold start (after restart) rehydrate the cap
  // and sleep from the persisted DB columns instead of resetting them (DE-6).
  let state = phaseMap.get(flight.id)
  if (!state) {
    const etaMs = (flight.arrivalEstimated ?? flight.arrivalScheduled).getTime()
    const persistedPhase = (flight.trackingPhase as TrackingPhase | null) ?? computedPhase
    state = {
      flightId: flight.id,
      phase: persistedPhase,
      isShared: false,
      isSharedChecked: false,
      lastAdsbPoll: 0,
      lastEnrichment: 0,
      enrichmentCount: flight.enrichmentCount ?? 0,
      baselineEtaMs: etaMs,
      wakeAt: flight.wakeAt ? flight.wakeAt.getTime() : null,
      groundConfirmations: 0,
    }
    phaseMap.set(flight.id, state)
    console.log(`[orchestrator] Tracking flight ${flight.ident} — phase: ${state.phase} (count=${state.enrichmentCount})`)
  }

  // Detect phase transitions (poller may have updated DB fields). Don't let a
  // recomputed phase drag us BACKWARDS (e.g. ARRIVING → EN_ROUTE) once we've
  // advanced past it on ADSB evidence.
  const ORDER: TrackingPhase[] = ['SCHEDULED', 'IN_TERMINAL', 'EN_ROUTE', 'ARRIVING', 'ARRIVED']
  if (computedPhase !== state.phase && ORDER.indexOf(computedPhase) > ORDER.indexOf(state.phase)) {
    console.log(`[orchestrator] Flight ${flight.ident} phase transition: ${state.phase} → ${computedPhase}`)
    state.phase = computedPhase
    state.wakeAt = null  // reset sleep on phase change
    state.groundConfirmations = 0
  }

  const phaseBefore = state.phase
  const countBefore = state.enrichmentCount
  const wakeBefore = state.wakeAt

  // ── Phase handlers ───────────────────────────────────────────────────────

  switch (state.phase) {
    case 'SCHEDULED': {
      // Nothing to do — poller handles schedule-change detection
      break
    }

    case 'IN_TERMINAL': {
      if (now - state.lastAdsbPoll < ADSB_TERMINAL_MS) break

      state.lastAdsbPoll = now
      const pos = await pollAdsb(flight)
      if (!pos || pos.isStale) break

      if (isTaxiingOrRolling(pos) || hasLiftedOff(pos)) {
        console.log(`[orchestrator] Flight ${flight.ident} entering EN_ROUTE phase`)
        state.phase = 'EN_ROUTE'
        state.wakeAt = null

        // DE-10: reserve the final enrichment slot for the arrival call.
        if (await canEnrich(state, true)) {
          const enrichment = await fetchGateEnrichment(resolveEnrichmentId(flight))
          if (enrichment) {
            await prisma.flight.update({
              where: { id: flight.id },
              data: {
                gateDeparture:     enrichment.gateDeparture     ?? undefined,
                terminalDeparture: enrichment.terminalDeparture ?? undefined,
                takeoffActual:     enrichment.actualOff         ?? undefined,
                // DE-9: departureActual is gate-out (actual_out) only, NEVER an
                // estimate. estimated_out is not an actual departure.
                departureActual:   enrichment.actualOut         ?? undefined,
                // DE-3: always write canonical status.
                status:            enrichment.status ? normalizeStatus(enrichment.status).status : undefined,
              },
            })
            console.log(`[orchestrator] Flight ${flight.ident} departure enrichment applied`)
            // DE-4: only count the cap against a successful (non-null) result.
            state.enrichmentCount++
            state.lastEnrichment = now
          }
        }
      }
      break
    }

    case 'EN_ROUTE': {
      // DE-12: resolve isShared once per lifecycle and cache it on the phase
      // state instead of running a DB count every en-route cycle.
      if (!state.isSharedChecked) {
        state.isShared = (await prisma.shareToken.count({ where: { flightId: flight.id } })) > 0
        state.isSharedChecked = true
      }
      const isShared = state.isShared

      if (!isShared) {
        // Put flight to sleep until 20min before ETA
        const etaMs = (flight.arrivalEstimated ?? flight.arrivalScheduled).getTime()
        const wakeAt = etaMs - TWENTY_MIN_MS
        if (!state.wakeAt) {
          state.wakeAt = wakeAt
          console.log(
            `[orchestrator] Flight ${flight.ident} is private, sleeping until 20min before ETA (${new Date(wakeAt).toISOString()})`
          )
        }
        if (now < wakeAt) break
        // Wake up — transition to ARRIVING
        console.log(`[orchestrator] Flight ${flight.ident} waking up — entering ARRIVING phase`)
        state.phase = 'ARRIVING'
        state.wakeAt = null
        break
      }

      // Shared flight — Deviation Threshold Guard
      if (now - state.lastAdsbPoll < ADSB_EN_ROUTE_MS) break
      state.lastAdsbPoll = now

      const pos = await pollAdsb(flight)
      if (!pos || pos.isStale || pos.latitude == null || pos.longitude == null) break

      // Check proximity to destination for ARRIVING transition
      const destCoords = flight.destination ? getAirportCoords(flight.destination) : null
      if (destCoords) {
        const remainingKm = haversineKm(pos.latitude, pos.longitude, destCoords[0], destCoords[1])
        const speedKmh = Math.max(pos.groundSpeedKnots * 1.852, 200)
        const remainingMs = (remainingKm / speedKmh) * 3600 * 1000
        const estimatedArrivalMs = now + remainingMs

        // Transition to ARRIVING if within 20 minutes
        if (remainingMs <= TWENTY_MIN_MS) {
          console.log(`[orchestrator] Flight ${flight.ident} entering ARRIVING phase`)
          state.phase = 'ARRIVING'
          state.wakeAt = null
          break
        }

        // ETA deviation check
        const deviation = Math.abs(estimatedArrivalMs - state.baselineEtaMs)
        // DE-10: reserve the final slot for the arrival enrichment.
        if (deviation > ETA_DEVIATION_MS && await canEnrich(state, true)) {
          const enrichment = await fetchGateEnrichment(resolveEnrichmentId(flight))
          if (enrichment) {
            const newArrival = enrichment.estimatedIn
            await prisma.flight.update({
              where: { id: flight.id },
              data: {
                arrivalEstimated: newArrival ?? undefined,
                // DE-3: canonical status only.
                status: enrichment.status ? normalizeStatus(enrichment.status).status : undefined,
              },
            })
            state.baselineEtaMs = newArrival
              ? newArrival.getTime()
              : estimatedArrivalMs
            console.log(
              `[orchestrator] Flight ${flight.ident} ETA deviation >${Math.round(deviation / 60000)}min, enriched`
            )
            // DE-4: count only on success.
            state.enrichmentCount++
            state.lastEnrichment = now
          }
        }
      }
      break
    }

    case 'ARRIVING': {
      if (now - state.lastAdsbPoll < ADSB_ARRIVING_MS) break
      state.lastAdsbPoll = now

      const pos = await pollAdsb(flight)
      if (!pos || pos.isStale) break

      // DE-7: require TWO consecutive on-ground samples within ~5km of the
      // destination before declaring arrival. This replaces the old
      // `onGround || altitudeFt < 500` false-positive (overflights, and
      // high-elevation airports like DEN where field elevation > 5000ft).
      const destCoords = flight.destination ? getAirportCoords(flight.destination) : null
      const sampleLanded = destCoords
        ? isLandedSample(pos, destCoords[0], destCoords[1], LANDING_PROXIMITY_KM)
        : // No coords known — fall back to on-ground only (no altitude heuristic).
          pos.onGround === true

      if (sampleLanded) {
        state.groundConfirmations++
      } else {
        state.groundConfirmations = 0
      }

      if (state.groundConfirmations >= LANDING_CONFIRMATIONS) {
        // This arrival call is the reserved slot — no reservation here.
        if (await canEnrich(state)) {
          const enrichment = await fetchGateEnrichment(resolveEnrichmentId(flight))
          await prisma.flight.update({
            where: { id: flight.id },
            data: {
              gateArrival:     enrichment?.gateArrival     ?? undefined,
              terminalArrival: enrichment?.terminalArrival ?? undefined,
              baggageClaim:    enrichment?.baggageClaim    ?? undefined,
              landingActual:   enrichment?.actualOn        ?? new Date(),
              // DE-9: arrivalActual (gate-in) only from FA actual_in, never an
              // estimate. Fall back to wheels-on time, else now.
              arrivalActual:   enrichment?.actualIn ?? enrichment?.actualOn ?? new Date(),
              // DE-3: terminal canonical status is `arrived`.
              status:          'arrived',
            },
          })
          console.log(
            `[orchestrator] Flight ${flight.ident} ARRIVED — gate ${enrichment?.gateArrival ?? 'unknown'}, baggage ${enrichment?.baggageClaim ?? 'unknown'}`
          )
          // DE-4: count only when we actually got a result.
          if (enrichment) {
            state.enrichmentCount++
            state.lastEnrichment = now
          }
        } else {
          // Even if enrichment is blocked, record landing time
          await prisma.flight.update({
            where: { id: flight.id },
            data: { landingActual: new Date(), arrivalActual: new Date(), status: 'arrived' },
          })
          console.log(`[orchestrator] Flight ${flight.ident} ARRIVED (no enrichment — cap/budget)`)
        }

        state.phase = 'ARRIVED'
        await persistState(state)
        phaseMap.delete(flight.id)
        return
      }
      break
    }

    case 'ARRIVED': {
      // Shouldn't normally reach here — we delete from map on arrival
      phaseMap.delete(flight.id)
      break
    }
  }

  // DE-6: persist phase/count/wakeAt whenever they changed this cycle so a
  // restart resumes the cap and sleep instead of resetting them.
  if (
    state.phase !== phaseBefore ||
    state.enrichmentCount !== countBefore ||
    state.wakeAt !== wakeBefore
  ) {
    await persistState(state)
  }
}

// ── Main orchestration loop ───────────────────────────────────────────────────

async function runOrchestratorCycle(): Promise<void> {
  const now = new Date()
  const windowStart = new Date(now.getTime() - TWELVE_HOURS_MS)  // departed up to 12h ago
  const windowEnd   = new Date(now.getTime() + TWELVE_HOURS_MS)  // departing in next 12h

  let flights: OrchestratorFlight[]

  try {
    flights = await prisma.flight.findMany({
      where: {
        status: { notIn: [...TERMINAL_STATUSES] },
        OR: [
          // Departing within next 12h
          { departureScheduled: { gte: now, lte: windowEnd } },
          // Already departed in last 12h but no arrival yet
          {
            departureScheduled: { gte: windowStart, lt: now },
            arrivalActual: null,
          },
        ],
      },
      select: {
        id: true,
        ident: true,
        registration: true,
        icaoHex: true,
        faFlightId: true,
        departureScheduled: true,
        takeoffActual: true,
        arrivalActual: true,
        arrivalEstimated: true,
        arrivalScheduled: true,
        destination: true,
        status: true,
        lastPolledAt: true,
        trackingPhase: true,
        enrichmentCount: true,
        wakeAt: true,
      },
    })
  } catch (err) {
    console.error('[orchestrator] DB query failed:', err)
    return
  }

  if (flights.length === 0) return

  // Process each flight independently — one failure must not kill others
  await Promise.allSettled(
    flights.map(async (flight) => {
      try {
        await processFlight(flight)
      } catch (err) {
        console.error(`[orchestrator] Error processing flight ${flight.ident} (${flight.id}):`, err)
      }
    })
  )
}

// ── Public API ────────────────────────────────────────────────────────────────

export function startTrackingOrchestrator(): void {
  console.log('[orchestrator] Starting dual-engine tracking orchestrator (30s interval)')
  runOrchestratorCycle().catch((err) => console.error('[orchestrator] Initial cycle error:', err))
  setInterval(() => {
    runOrchestratorCycle().catch((err) => console.error('[orchestrator] Cycle error:', err))
  }, LOOP_INTERVAL_MS)
}

export function getOrchestratorStatus(): { activeFlights: number; phases: Record<string, string> } {
  const phases: Record<string, string> = {}
  for (const [flightId, state] of phaseMap.entries()) {
    phases[flightId] = state.phase
  }
  return { activeFlights: phaseMap.size, phases }
}
