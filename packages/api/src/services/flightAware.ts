import { getSettingWithEnvFallback } from '../lib/settings.js'
import { incrementUsage, isOverBudget } from '../lib/apiBudget.js'
import { normalizeStatus } from '../lib/flightStatus.js'
import { generateStubFlight } from './stubData.js'
import { lookupAeroDataBox, lookupAllLegsAeroDataBox, getAeroDataBoxKey, ADB_PROVIDER } from './aeroDataBox.js'

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

/**
 * Typed subset of the FlightAware AeroAPI v4 `flights[]` object that we consume.
 * Defined explicitly (GEN-7) so the FA boundary is no longer `any`.
 */
interface FaAirportRef {
  code_iata?: string | null
  code?: string | null
}

interface FaFlight {
  fa_flight_id?: string | null
  operator_iata?: string | null
  flight_number?: string | number | null
  origin?: FaAirportRef | null
  destination?: FaAirportRef | null
  scheduled_out?: string | null
  scheduled_off?: string | null
  estimated_out?: string | null
  estimated_off?: string | null
  actual_out?: string | null
  actual_off?: string | null
  scheduled_in?: string | null
  scheduled_on?: string | null
  estimated_in?: string | null
  estimated_on?: string | null
  actual_in?: string | null
  actual_on?: string | null
  status?: string | null
  gate_origin?: string | null
  gate_destination?: string | null
  terminal_origin?: string | null
  terminal_destination?: string | null
  baggage_claim?: string | null
  aircraft_type?: string | null
  registration?: string | null
}

function mapFlight(f: FaFlight): FlightData {
  return {
    faFlightId: f.fa_flight_id ?? undefined,
    airlineIata: f.operator_iata ?? undefined,
    flightNumber: f.flight_number != null ? String(f.flight_number) : undefined,
    origin: f.origin?.code_iata ?? f.origin?.code ?? '',
    destination: f.destination?.code_iata ?? f.destination?.code ?? '',
    // Gate OUT/IN (departure/arrival times)
    departureScheduled: new Date(f.scheduled_out ?? f.scheduled_off ?? NaN),
    departureEstimated: parseDate(f.estimated_out ?? f.estimated_off),
    departureActual: parseDate(f.actual_out ?? f.actual_off),
    arrivalScheduled: new Date(f.scheduled_in ?? f.scheduled_on ?? NaN),
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

/**
 * ADD-4: Compute the UTC window that fully covers the *local airport calendar
 * day* for `date` (YYYY-MM-DD), regardless of which timezone the origin sits in.
 *
 * The old window (`date T00:00Z` → `date+1 T06:00Z`) was anchored on raw UTC
 * midnight, so an evening-local flight in a positive-UTC zone (e.g. a 21:00
 * local departure in Asia/Tokyo, UTC+9, which is `date-1 12:00Z`) fell *before*
 * the window and returned a false 404. Earth's offsets span UTC-12..UTC+14, so
 * widening the window by 14h on each side guarantees the whole local day of any
 * airport is contained. Returns AeroAPI-ready ISO strings (no millis).
 */
function localDayWindowUtc(date: string): { start: string; end: string } {
  const dayStart = new Date(date + 'T00:00:00Z').getTime()
  const dayEnd = new Date(nextDay(date) + 'T00:00:00Z').getTime()
  const PAD_MS = 14 * 60 * 60 * 1000 // max +14 / -12 offset, padded to 14 both ways
  const start = new Date(dayStart - PAD_MS).toISOString().replace(/\.\d{3}Z$/, 'Z')
  const end = new Date(dayEnd + PAD_MS).toISOString().replace(/\.\d{3}Z$/, 'Z')
  return { start, end }
}

async function lookupFlightAware(ident: string, date: string): Promise<FlightData | null> {
  const apiKey = await getApiKey()
  // AeroAPI v4 requires ISO 8601 datetimes and a non-zero window spanning the
  // flight's LOCAL day (ADD-4) — anchored on the airport day, not UTC midnight.
  const { start, end } = localDayWindowUtc(date)
  const url = `${AEROAPI_BASE}/flights/${encodeURIComponent(ident)}?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}&max_pages=1`
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

  return mapFlight(flights[0] as FaFlight)
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
    // fetch them all and let the UI pick. Window anchored on the local day (ADD-4).
    const { start, end } = localDayWindowUtc(date)
    const url = `${AEROAPI_BASE}/flights/${encodeURIComponent(ident)}?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}&max_pages=1`
    await incrementUsage('aeroapi')
    try {
      const res = await fetch(url, { headers: { 'x-apikey': apiKey } })
      if (!res.ok) return []
      const data = await res.json() as { flights?: unknown[] }
      return (data.flights ?? []).map((f) => mapFlight(f as FaFlight))
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

/**
 * Provider-aware leg lookup (ADD-6). Same data as `lookupAllFlightLegs` but also
 * reports which provider produced the result so the UI can show a "demo data"
 * banner. Demo is only used when no real provider is configured.
 */
export async function lookupAllFlightLegsWithProvider(
  ident: string,
  date: string,
): Promise<{ provider: ProviderId; legs: FlightData[] }> {
  const provider = await getActiveProvider()
  const legs = await lookupAllFlightLegs(ident, date)
  return { provider, legs }
}

export interface UpcomingOccurrence {
  date: string // YYYY-MM-DD (the scanned local day this leg was found on)
  legs: FlightData[]
}

export interface UpcomingResult {
  provider: ProviderId
  ident: string
  occurrences: UpcomingOccurrence[]
}

/**
 * ADD-2: Find the next upcoming occurrences of a flight number, scanning from
 * today through +`days`. Real trackers take just the flight number → show the
 * next departure → let the user pick a date, so a flight that next flies
 * tomorrow no longer 404s.
 *
 * Budget discipline: we stop scanning as soon as the active provider goes over
 * budget (so we never burn the whole month's quota on one search), and demo
 * mode is free so it always scans the full range. Each day reuses the existing
 * windowed `lookupAllFlightLegs`, so the local-day anchoring (ADD-4) applies.
 */
export async function lookupUpcoming(
  ident: string,
  days = 7,
  today: Date = new Date(),
): Promise<UpcomingResult> {
  const provider = await getActiveProvider()
  const occurrences: UpcomingOccurrence[] = []

  for (let i = 0; i <= days; i++) {
    // Respect the meter: bail out of further paid scans once over budget, but
    // keep whatever we've already found. Demo provider is free → never bails.
    if (provider !== 'demo' && (await isActiveProviderOverBudget())) break

    const d = new Date(today.getTime())
    d.setUTCDate(d.getUTCDate() + i)
    const date = d.toISOString().substring(0, 10)

    const legs = await lookupAllFlightLegs(ident, date)
    // Keep only legs whose scheduled departure is still in the future (today's
    // already-departed legs aren't "upcoming") and that actually belong to this
    // scanned day (the wide ADD-4 window can return adjacent-day legs).
    const upcomingLegs = legs.filter(
      (l) =>
        l.departureScheduled instanceof Date &&
        !isNaN(l.departureScheduled.getTime()) &&
        l.departureScheduled.getTime() >= today.getTime() &&
        l.departureScheduled.toISOString().substring(0, 10) === date,
    )
    if (upcomingLegs.length > 0) {
      occurrences.push({ date, legs: upcomingLegs })
    }
  }

  return { provider, ident, occurrences }
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
  return mapFlight(flights[0] as FaFlight)
}

