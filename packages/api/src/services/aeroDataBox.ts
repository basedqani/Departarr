// ─────────────────────────────────────────────────────────────────────────────
// AeroDataBox provider (real flight data, free tier — no credit card)
//
// AeroDataBox on RapidAPI offers 600 free units/month and supports flight lookup
// by number AND date, including upcoming/scheduled flights — which is exactly
// what a "track my flight in advance" app needs (unlike position-only sources).
//
//   GET https://aerodatabox.p.rapidapi.com/flights/number/{number}/{date}
//   headers: x-rapidapi-key, x-rapidapi-host: aerodatabox.p.rapidapi.com
//
// The admin sets one key in Settings → Data Sources and every user gets real
// data for free. Docs: https://doc.aerodatabox.com/
// ─────────────────────────────────────────────────────────────────────────────

import { getSettingWithEnvFallback } from '../lib/settings.js'
import { incrementUsage } from '../lib/apiBudget.js'
import type { FlightData } from './flightAware.js'

const ADB_HOST = 'aerodatabox.p.rapidapi.com'
const ADB_BASE = `https://${ADB_HOST}`

export const ADB_PROVIDER = 'aerodatabox'

export async function getAeroDataBoxKey(): Promise<string> {
  return (await getSettingWithEnvFallback('aerodatabox_api_key', 'AERODATABOX_API_KEY')) ?? ''
}

// AeroDataBox times look like "2026-06-13 22:30Z" (space, not ISO 'T'). Parse
// robustly so both that shape and plain ISO strings work.
function parseAdbTime(t: { utc?: string | null } | null | undefined): Date | undefined {
  const raw = t?.utc
  if (!raw) return undefined
  const iso = raw.includes('T') ? raw : raw.replace(' ', 'T')
  const d = new Date(iso)
  return isNaN(d.getTime()) ? undefined : d
}

// Map AeroDataBox status strings → our internal vocabulary.
function mapStatus(s: string | undefined): string {
  switch ((s ?? '').toLowerCase()) {
    case 'expected':
    case 'scheduled':       return 'scheduled'
    case 'checkin':
    case 'boarding':        return 'boarding'
    case 'gateclosed':
    case 'departed':        return 'departed'
    case 'enroute':
    case 'approaching':     return 'en_route'
    case 'arrived':         return 'arrived'
    case 'delayed':         return 'scheduled'
    case 'canceled':
    case 'cancelled':
    case 'canceleduncertain': return 'cancelled'
    case 'diverted':        return 'diverted'
    default:                return 'scheduled'
  }
}

interface AdbEndpoint {
  airport?: { iata?: string; icao?: string }
  scheduledTime?: { utc?: string }
  revisedTime?: { utc?: string }
  predictedTime?: { utc?: string }
  runwayTime?: { utc?: string }
  terminal?: string
  gate?: string
  baggageBelt?: string
}

interface AdbFlight {
  number?: string
  status?: string
  airline?: { iata?: string; icao?: string; name?: string }
  aircraft?: { model?: string; reg?: string }
  departure?: AdbEndpoint
  arrival?: AdbEndpoint
}

function mapAdbFlight(f: AdbFlight, ident: string, date: string): FlightData | null {
  const dep = f.departure
  const arr = f.arrival
  const depSched = parseAdbTime(dep?.scheduledTime)
  const arrSched = parseAdbTime(arr?.scheduledTime)
  // A usable flight needs both endpoints and a scheduled departure
  if (!dep?.airport?.iata || !arr?.airport?.iata || !depSched || !arrSched) return null

  const depRevised = parseAdbTime(dep?.revisedTime)
  const arrRevised = parseAdbTime(arr?.revisedTime) ?? parseAdbTime(arr?.predictedTime)
  const status = mapStatus(f.status)
  const departed = status === 'departed' || status === 'en_route' || status === 'arrived'
  const arrived = status === 'arrived'

  const depRunway = parseAdbTime(dep?.runwayTime)
  const arrRunway = parseAdbTime(arr?.runwayTime)

  // RapidAPI flight number is like "BA 178" — normalise spacing, then strip the
  // airline code prefix to get the bare number ("178").
  const iata = f.airline?.iata ?? ident.slice(0, 2)
  const flightNum = (f.number ?? ident).replace(/\s+/g, '')
  const bareNumber = flightNum.toUpperCase().startsWith(iata.toUpperCase())
    ? flightNum.slice(iata.length)
    : flightNum.replace(/^[A-Z]+/, '')

  return {
    faFlightId: `ADB:${ident}:${date}`,
    airlineIata: iata,
    flightNumber: bareNumber,
    origin: dep.airport.iata,
    destination: arr.airport.iata,
    departureScheduled: depSched,
    // "revised" carries estimate before departure, actual after
    departureEstimated: !departed ? depRevised : undefined,
    departureActual: departed ? (depRevised ?? depSched) : undefined,
    arrivalScheduled: arrSched,
    arrivalEstimated: !arrived ? arrRevised : undefined,
    arrivalActual: arrived ? (arrRevised ?? arrSched) : undefined,
    takeoffScheduled: depRunway && !departed ? depRunway : undefined,
    takeoffActual: departed ? depRunway : undefined,
    landingScheduled: arrRunway && !arrived ? arrRunway : undefined,
    landingActual: arrived ? arrRunway : undefined,
    status,
    gateDeparture: dep.gate ?? undefined,
    gateArrival: arr.gate ?? undefined,
    terminalDeparture: dep.terminal ?? undefined,
    terminalArrival: arr.terminal ?? undefined,
    baggageClaim: arr.baggageBelt ?? undefined,
    aircraftType: f.aircraft?.model ?? undefined,
    registration: f.aircraft?.reg ?? undefined,
  }
}

/**
 * Look up a real flight by number + date via AeroDataBox. Returns null if no
 * key is configured or no flight is found.
 */
export async function lookupAeroDataBox(ident: string, date: string): Promise<FlightData | null> {
  const key = await getAeroDataBoxKey()
  if (!key) return null

  const url = `${ADB_BASE}/flights/number/${encodeURIComponent(ident)}/${date}?withAircraftImage=false&withLocation=false`
  await incrementUsage(ADB_PROVIDER)

  let res: Response
  try {
    res = await fetch(url, {
      headers: { 'x-rapidapi-key': key, 'x-rapidapi-host': ADB_HOST },
      signal: AbortSignal.timeout(12_000),
    })
  } catch (err) {
    console.error('AeroDataBox request failed:', err)
    return null
  }

  if (res.status === 404) return null // no flight for that number/date
  if (!res.ok) {
    console.error(`AeroDataBox error ${res.status}: ${await res.text().catch(() => '')}`)
    return null
  }

  // Response is an array of legs (a flight number can have multiple legs/days)
  const data = (await res.json().catch(() => null)) as AdbFlight[] | AdbFlight | null
  if (!data) return null
  const flights = Array.isArray(data) ? data : [data]
  if (flights.length === 0) return null

  // Prefer the leg whose scheduled departure date matches the requested date
  const matching = flights.find(f => {
    const d = parseAdbTime(f.departure?.scheduledTime)
    return d && d.toISOString().substring(0, 10) === date
  }) ?? flights[0]

  return mapAdbFlight(matching, ident, date)
}
