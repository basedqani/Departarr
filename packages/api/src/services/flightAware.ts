import { getSettingWithEnvFallback } from '../lib/settings.js'
import { incrementUsage, isOverBudget } from '../lib/apiBudget.js'
import { generateStubFlight } from './stubData.js'
import { lookupAeroDataBox, lookupAllLegsAeroDataBox, getAeroDataBoxKey, ADB_PROVIDER } from './aeroDataBox.js'
import { normalizeStatus } from '../lib/flightStatus.js'

const AEROAPI_BASE = 'https://aeroapi.flightaware.com/aeroapi'

export type ProviderId = 'flightaware' | 'aerodatabox' | 'demo'

/**
 * Which real data provider is active, in priority order:
 *   FlightAware (premium) → AeroDataBox (free real data) → Demo (no key).
 */
export async function getActiveProvider(): Promise<ProviderId> {
  if (await getApiKey()) return 'flightaware'
  if (await getAeroDataBoxKey()) return 'aerodatabox'
  return 'demo'
}

/** Budget guard the poller consults before making real calls. Demo = free. */
export async function isActiveProviderOverBudget(): Promise<boolean> {
  const provider = await getActiveProvider()
  if (provider === 'flightaware') return isOverBudget('aeroapi')
  if (provider === 'aerodatabox') return isOverBudget(ADB_PROVIDER)
  return false // demo mode never costs anything
}

export interface FlightData {
  faFlightId?: string
  airlineIata?: string
  flightNumber?: string
  origin: string
  destination: string
  departureScheduled: Date
  departureEstimated?: Date
  departureActual?: Date
  arrivalScheduled: Date
  arrivalEstimated?: Date
  arrivalActual?: Date
  // OOOI wheel-off/on times
  takeoffScheduled?: Date
  takeoffEstimated?: Date
  takeoffActual?: Date
  landingScheduled?: Date
  landingEstimated?: Date
  landingActual?: Date
  status: string
  gateDeparture?: string
  gateArrival?: string
  terminalDeparture?: string
  terminalArrival?: string
  baggageClaim?: string
  aircraftType?: string
  registration?: string
}

async function getApiKey(): Promise<string> {
  return (await getSettingWithEnvFallback('flightaware_api_key', 'FLIGHTAWARE_API_KEY')) ?? ''
}

function parseDate(val: string | null | undefined): Date | undefined {
  if (!val) return undefined
  const d = new Date(val)
  return isNaN(d.getTime()) ? undefined : d
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapFlight(f: any): FlightData {
  return {
    faFlightId: f.fa_flight_id ?? undefined,
    airlineIata: f.operator_iata ?? undefined,
    flightNumber: f.flight_number != null ? String(f.flight_number) : undefined,
    origin: f.origin?.code_iata ?? f.origin?.code ?? '',
    destination: f.destination?.code_iata ?? f.destination?.code ?? '',
    // Gate OUT/IN (departure/arrival times)
    departureScheduled: new Date(f.scheduled_out ?? f.scheduled_off),
    departureEstimated: parseDate(f.estimated_out ?? f.estimated_off),
    departureActual: parseDate(f.actual_out ?? f.actual_off),
    arrivalScheduled: new Date(f.scheduled_in ?? f.scheduled_on),
    arrivalEstimated: parseDate(f.estimated_in ?? f.estimated_on),
    arrivalActual: parseDate(f.actual_in ?? f.actual_on),
    // OOOI wheel-off/on times
    takeoffScheduled: parseDate(f.scheduled_off),
    takeoffEstimated: parseDate(f.estimated_off),
    takeoffActual: parseDate(f.actual_off),
    landingScheduled: parseDate(f.scheduled_on),
    landingEstimated: parseDate(f.estimated_on),
    landingActual: parseDate(f.actual_on),
    status: normalizeStatus(f.status).status,
    gateDeparture: f.gate_origin ?? undefined,
    gateArrival: f.gate_destination ?? undefined,
    terminalDeparture: f.terminal_origin ?? undefined,
    terminalArrival: f.terminal_destination ?? undefined,
    baggageClaim: f.baggage_claim ?? undefined,
    aircraftType: f.aircraft_type ?? undefined,
    registration: f.registration ?? undefined,
  }
}

/**
 * Public flight lookup — dispatches to the active provider:
 *   FlightAware → AeroDataBox → Demo. Real providers fall through to demo only
 *   when unconfigured, never on a "flight not found" (that returns null so the
 *   user sees an honest "couldn't find that flight" message).
 */
export async function lookupFlight(
  ident: string,
  date: string,
  hint?: { origin?: string; dest?: string; departureUtc?: string },
): Promise<FlightData | null> {
  const apiKey = await getApiKey()
  if (apiKey) {
    const result = await lookupFlightAware(ident, date)
    if (result) return result
    // FA failed (no key budget, network error) — fall through
  }

  if (await getAeroDataBoxKey()) {
    try {
      const result = await lookupAeroDataBox(ident, date, hint)
      if (result) return result
    } catch {
      // AeroDataBox over quota or error — fall through to demo
    }
  }

  // No real provider available or all failed → deterministic demo data (free, no cost)
  return generateStubFlight(ident, date)
}

function nextDay(date: string): string {
  const d = new Date(date + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().substring(0, 10)
}

async function lookupFlightAware(ident: string, date: string): Promise<FlightData | null> {
  const apiKey = await getApiKey()
  // AeroAPI v4 requires ISO 8601 datetimes and a non-zero window spanning the flight day
  const url = `${AEROAPI_BASE}/flights/${encodeURIComponent(ident)}?start=${date}T00%3A00%3A00Z&end=${nextDay(date)}T06%3A00%3A00Z&max_pages=1`
  await incrementUsage('aeroapi')
  const res = await fetch(url, { headers: { 'x-apikey': apiKey } })

  if (!res.ok) {
    const text = await res.text()
    console.error(`[FlightAware] ${res.status} for ${ident} on ${date}: ${text}`)
    return null
  }

  const data = await res.json() as { flights?: unknown[] }
  const flights = data.flights ?? []
  if (flights.length === 0) return null

  return mapFlight(flights[0])
}

/**
 * Return all legs for a flight number + date. Used by the leg-picker so the
 * user can select the right direction. Falls back to a single-item array when
 * only FlightAware (which doesn't expose multi-leg in one call) is available.
 */
export async function lookupAllFlightLegs(
  ident: string,
  date: string,
): Promise<FlightData[]> {
  const apiKey = await getApiKey()
  if (apiKey) {
    // FlightAware returns multiple entries for different legs in the same call;
    // fetch them all and let the UI pick.
    const url = `${AEROAPI_BASE}/flights/${encodeURIComponent(ident)}?start=${date}T00%3A00%3A00Z&end=${nextDay(date)}T06%3A00%3A00Z&max_pages=1`
    await incrementUsage('aeroapi')
    try {
      const res = await fetch(url, { headers: { 'x-apikey': apiKey } })
      if (!res.ok) return []
      const data = await res.json() as { flights?: unknown[] }
      return (data.flights ?? []).map((f) => mapFlight(f as Parameters<typeof mapFlight>[0]))
    } catch {
      return []
    }
  }

  if (await getAeroDataBoxKey()) {
    try {
      const legs = await lookupAllLegsAeroDataBox(ident, date)
      if (legs.length > 0) return legs
    } catch {
      // AeroDataBox over quota or error — fall through to demo
    }
  }

  // Demo mode: single stub leg
  const stub = await generateStubFlight(ident, date)
  return stub ? [stub] : []
}

export async function fetchFlightById(faFlightId: string): Promise<FlightData | null> {
  // Demo flights regenerate from their encoded ident+date so their live status
  // advances over time (the poller picks up the progression for free).
  if (faFlightId.startsWith('STUB-')) {
    const rest = faFlightId.slice(5) // strip "STUB-"
    const dash = rest.lastIndexOf('-')
    if (dash > 0) {
      return generateStubFlight(rest.slice(0, dash), rest.slice(dash + 1))
    }
    return null
  }

  // AeroDataBox-tracked flights re-lookup by number + date (no stable FA id).
  // Format: ADB:<ident>:<date> (legacy) OR ADB:<ident>:<date>:<ORIG>-<DEST> (new)
  if (faFlightId.startsWith('ADB:')) {
    const parts = faFlightId.split(':')
    const ident = parts[1]
    const date = parts[2]
    if (!ident || !date) return null
    const legSegment = parts[3] // e.g. "ORD-MSP" or undefined
    if (legSegment && /^[A-Z]{3}-[A-Z]{3}$/.test(legSegment)) {
      const [origin, dest] = legSegment.split('-')
      return lookupAeroDataBox(ident, date, { origin, dest })
    }
    return lookupAeroDataBox(ident, date)
  }

  // Otherwise it's a FlightAware fa_flight_id — only usable with an FA key.
  const apiKey = await getApiKey()
  if (!apiKey) return null

  const url = `${AEROAPI_BASE}/flights/${encodeURIComponent(faFlightId)}`
  // Count this billable call BEFORE the fetch (so we count even on error)
  await incrementUsage('aeroapi')
  const res = await fetch(url, { headers: { 'x-apikey': apiKey } })
  if (!res.ok) return null

  const data = await res.json() as { flights?: unknown[] }
  const flights = data.flights ?? []
  if (flights.length === 0) return null
  return mapFlight(flights[0])
}

