import { getSettingWithEnvFallback } from '../lib/settings.js'
import { incrementUsage } from '../lib/apiBudget.js'

const AEROAPI_BASE = 'https://aeroapi.flightaware.com/aeroapi'

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
    status: (f.status ?? 'scheduled').toLowerCase().replace(/\s+/g, '_'),
    gateDeparture: f.gate_origin ?? undefined,
    gateArrival: f.gate_destination ?? undefined,
    terminalDeparture: f.terminal_origin ?? undefined,
    terminalArrival: f.terminal_destination ?? undefined,
    baggageClaim: f.baggage_claim ?? undefined,
    aircraftType: f.aircraft_type ?? undefined,
    registration: f.registration ?? undefined,
  }
}

export async function lookupFlight(ident: string, date: string): Promise<FlightData | null> {
  const apiKey = await getApiKey()
  if (!apiKey) {
    console.warn('FlightAware API key not set — returning stub flight data')
    return stubFlight(ident, date)
  }

  const url = `${AEROAPI_BASE}/flights/${encodeURIComponent(ident)}?start=${date}&end=${date}`
  // Count this billable call BEFORE the fetch (so we count even on error)
  await incrementUsage()
  const res = await fetch(url, {
    headers: { 'x-apikey': apiKey },
  })

  if (!res.ok) {
    const text = await res.text()
    console.error(`FlightAware error ${res.status}: ${text}`)
    return null
  }

  const data = await res.json() as { flights?: unknown[] }
  const flights = data.flights ?? []
  if (flights.length === 0) return null

  return mapFlight(flights[0])
}

export async function fetchFlightById(faFlightId: string): Promise<FlightData | null> {
  const apiKey = await getApiKey()
  if (!apiKey) return null

  const url = `${AEROAPI_BASE}/flights/${encodeURIComponent(faFlightId)}`
  // Count this billable call BEFORE the fetch (so we count even on error)
  await incrementUsage()
  const res = await fetch(url, { headers: { 'x-apikey': apiKey } })
  if (!res.ok) return null

  const data = await res.json() as { flights?: unknown[] }
  const flights = data.flights ?? []
  if (flights.length === 0) return null
  return mapFlight(flights[0])
}

// Stub for dev without API key
function stubFlight(ident: string, date: string): FlightData {
  const base = new Date(`${date}T10:00:00Z`)
  const arr = new Date(base.getTime() + 2 * 60 * 60 * 1000)
  // Wheel-off ~15 min after gate departure, wheel-on ~10 min before gate arrival
  const takeoff = new Date(base.getTime() + 15 * 60 * 1000)
  const landing = new Date(arr.getTime() - 10 * 60 * 1000)
  return {
    faFlightId: `STUB-${ident}`,
    airlineIata: ident.slice(0, 2).toUpperCase(),
    flightNumber: ident.slice(2),
    origin: 'JFK',
    destination: 'LAX',
    departureScheduled: base,
    arrivalScheduled: arr,
    takeoffScheduled: takeoff,
    landingScheduled: landing,
    status: 'scheduled',
    gateDeparture: 'B12',
    gateArrival: 'C4',
    terminalDeparture: 'T2',
    terminalArrival: 'T4',
    aircraftType: 'B738',
    registration: `N${ident.replace(/\D/g, '').slice(0, 3)}DN`,
  }
}
