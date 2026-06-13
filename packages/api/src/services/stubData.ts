// ─────────────────────────────────────────────────────────────────────────────
// Free-mode flight generator
//
// When no FlightAware API key is configured, Departarr still produces beautiful,
// realistic, *deterministic* flight data so the whole app is fully usable for
// free. The same flight number + date always yields the same route, aircraft,
// gates and times — but the *status* is computed live from the clock, so a
// demo flight naturally progresses Scheduled → Boarding → Departed → En route →
// Landed as real time passes (and the poller emits real events as it does).
// ─────────────────────────────────────────────────────────────────────────────

import type { FlightData } from './flightAware.js'

// [origin, destination, typical block time in minutes]
const DOMESTIC_ROUTES: [string, string, number][] = [
  // Short-haul
  ['LAX', 'SFO', 75], ['JFK', 'BOS', 75], ['SFO', 'SEA', 130], ['LAX', 'LAS', 65],
  ['ATL', 'MCO', 90], ['ORD', 'LGA', 145], ['DFW', 'IAH', 75], ['SEA', 'PDX', 50],
  ['JFK', 'DCA', 85], ['LAX', 'PHX', 80], ['DEN', 'LAS', 130], ['MIA', 'ATL', 110],
  ['BOS', 'PHL', 90], ['SFO', 'SAN', 95], ['LGA', 'ORD', 155], ['SEA', 'SFO', 130],
  // Medium-haul / transcon
  ['JFK', 'LAX', 375], ['SFO', 'JFK', 330], ['SEA', 'JFK', 305], ['LAX', 'ORD', 255],
  ['BOS', 'SFO', 390], ['MIA', 'LAX', 335], ['DEN', 'JFK', 230], ['IAH', 'SFO', 250],
  ['ATL', 'LAX', 300], ['DFW', 'SFO', 245], ['LAS', 'JFK', 300], ['EWR', 'SFO', 380],
]

const INTL_ROUTES: [string, string, number][] = [
  ['JFK', 'LHR', 430], ['LAX', 'NRT', 700], ['SFO', 'HKG', 870], ['JFK', 'CDG', 445],
  ['LAX', 'SYD', 900], ['SFO', 'LHR', 650], ['JFK', 'FCO', 510], ['ORD', 'FRA', 540],
  ['SEA', 'ICN', 660], ['MIA', 'GRU', 520], ['JFK', 'AMS', 430], ['SFO', 'SIN', 1050],
  ['LAX', 'LHR', 645], ['EWR', 'DEL', 840], ['JFK', 'DXB', 760], ['BOS', 'DUB', 380],
  ['ORD', 'MUC', 525], ['LAX', 'ICN', 785], ['SFO', 'PVG', 840], ['JFK', 'MAD', 450],
]

// US carriers operate both domestic and international; foreign carriers are
// routed onto international routes (which all touch a US gateway) so we never
// show e.g. British Airways flying a US domestic hop.
const US_CARRIERS = new Set(['DL', 'AA', 'UA', 'WN', 'B6', 'AS', 'NK', 'F9', 'HA', 'G4'])

function routesFor(iata: string): [string, string, number][] {
  if (US_CARRIERS.has(iata)) return [...DOMESTIC_ROUTES, ...INTL_ROUTES]
  // Known foreign carrier → international only; unknown code → all (best effort)
  if (AIRLINES[iata]) return INTL_ROUTES
  return [...DOMESTIC_ROUTES, ...INTL_ROUTES]
}

interface Airline {
  name: string
  // Registration generator style
  reg: (seed: number) => string
}

const L = 'ABCDEFGHJKLMNPRSTUVWXYZ' // aircraft-reg friendly letters (no I, O, Q)
function letters(seed: number, n: number): string {
  let s = ''
  let x = seed
  for (let i = 0; i < n; i++) {
    s += L[x % L.length]
    x = Math.floor(x / L.length) + 7
  }
  return s
}
const nReg   = (s: number): string => `N${100 + (s % 899)}${letters(s, 2)}`           // US
const gReg   = (s: number): string => `G-${letters(s, 4)}`                            // UK
const dReg   = (s: number): string => `D-A${letters(s, 3)}`                           // Germany
const fReg   = (s: number): string => `F-G${letters(s, 3)}`                           // France
const phReg  = (s: number): string => `PH-${letters(s, 3)}`                           // Netherlands
const jaReg  = (s: number): string => `JA${800 + (s % 99)}${letters(s, 1)}`           // Japan
const hlReg  = (s: number): string => `HL${7000 + (s % 999)}`                         // Korea
const nineV  = (s: number): string => `9V-${letters(s, 3)}`                           // Singapore
const vhReg  = (s: number): string => `VH-${letters(s, 3)}`                           // Australia
const a6Reg  = (s: number): string => `A6-${letters(s, 3)}`                           // UAE
const bReg   = (s: number): string => `B-${letters(s, 4)}`                            // HK/China
const cReg   = (s: number): string => `C-F${letters(s, 3)}`                           // Canada

const AIRLINES: Record<string, Airline> = {
  DL: { name: 'Delta',            reg: nReg }, AA: { name: 'American',        reg: nReg },
  UA: { name: 'United',           reg: nReg }, WN: { name: 'Southwest',       reg: nReg },
  B6: { name: 'JetBlue',          reg: nReg }, AS: { name: 'Alaska',          reg: nReg },
  NK: { name: 'Spirit',           reg: nReg }, F9: { name: 'Frontier',        reg: nReg },
  HA: { name: 'Hawaiian',         reg: nReg }, G4: { name: 'Allegiant',       reg: nReg },
  BA: { name: 'British Airways',  reg: gReg }, VS: { name: 'Virgin Atlantic', reg: gReg },
  LH: { name: 'Lufthansa',        reg: dReg }, AF: { name: 'Air France',      reg: fReg },
  KL: { name: 'KLM',              reg: phReg}, NH: { name: 'ANA',             reg: jaReg},
  JL: { name: 'Japan Airlines',   reg: jaReg}, KE: { name: 'Korean Air',      reg: hlReg},
  OZ: { name: 'Asiana',           reg: hlReg}, SQ: { name: 'Singapore',       reg: nineV},
  QF: { name: 'Qantas',           reg: vhReg}, EK: { name: 'Emirates',        reg: a6Reg},
  CX: { name: 'Cathay Pacific',   reg: bReg }, AC: { name: 'Air Canada',      reg: cReg },
  EI: { name: 'Aer Lingus',       reg: gReg }, IB: { name: 'Iberia',          reg: fReg },
  TK: { name: 'Turkish',          reg: a6Reg},
}

// Aircraft families by block time
const AC_SHORT  = ['A319', 'A320', 'B737', 'E175', 'A20N']
const AC_MED    = ['A321', 'B738', 'B739', 'A21N']
const AC_TRANS  = ['B752', 'A21N', 'B739', 'A320']
const AC_WIDE   = ['B763', 'A332', 'B788', 'A21N']
const AC_LONG   = ['B789', 'A359', 'B77W', 'A388', 'B78X']

function aircraftFor(blockMin: number, seed: number): string {
  const pool =
    blockMin < 120 ? AC_SHORT :
    blockMin < 240 ? AC_MED :
    blockMin < 420 ? AC_TRANS :
    blockMin < 600 ? AC_WIDE : AC_LONG
  return pool[seed % pool.length]
}

// Simple deterministic string hash → unsigned int
function hashStr(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function gate(seed: number): string {
  const letter = 'ABCDEF'[seed % 6]
  const num = 1 + (seed % 32)
  return `${letter}${num}`
}

/**
 * Generate a realistic, deterministic flight whose live status is derived from
 * the current clock. Same ident+date ⇒ same route/aircraft/times; status moves
 * forward in real time.
 */
export function generateStubFlight(ident: string, date: string): FlightData {
  const cleanIdent = ident.toUpperCase().replace(/\s+/g, '')
  const iata = cleanIdent.slice(0, 2)
  const number = cleanIdent.slice(2) || '100'
  const airline = AIRLINES[iata]
  const seed = hashStr(`${cleanIdent}@${date}`)

  const routes = routesFor(iata)
  const [origin, destination, blockMin] = routes[seed % routes.length]

  // Departure hour: deterministic, biased toward daytime (6am–10pm)
  const depHour = 6 + (seed % 16)
  const depMin = (seed % 4) * 15
  const departureScheduled = new Date(`${date}T00:00:00.000Z`)
  departureScheduled.setUTCHours(depHour, depMin, 0, 0)

  const arrivalScheduled = new Date(departureScheduled.getTime() + blockMin * 60_000)

  // Wheels off ~15min after pushback; wheels on ~12min before gate-in
  const takeoffScheduled = new Date(departureScheduled.getTime() + 15 * 60_000)
  const landingScheduled = new Date(arrivalScheduled.getTime() - 12 * 60_000)

  // ~1 in 4 flights carries a realistic delay
  const delayMin = seed % 4 === 0 ? 8 + (seed % 38) : 0
  const dep = (base: Date): Date => new Date(base.getTime() + delayMin * 60_000)

  const departureEstimated = delayMin ? dep(departureScheduled) : undefined
  const arrivalEstimated   = delayMin ? dep(arrivalScheduled)   : undefined
  const takeoffEstimated   = delayMin ? dep(takeoffScheduled)   : undefined
  const landingEstimated   = delayMin ? dep(landingScheduled)   : undefined

  const effDep     = (departureEstimated ?? departureScheduled).getTime()
  const effTakeoff = (takeoffEstimated   ?? takeoffScheduled).getTime()
  const effLanding = (landingEstimated   ?? landingScheduled).getTime()
  const effArr     = (arrivalEstimated   ?? arrivalScheduled).getTime()

  const now = Date.now()

  // Phase-based status + actuals
  let status = 'scheduled'
  let departureActual: Date | undefined
  let takeoffActual: Date | undefined
  let landingActual: Date | undefined
  let arrivalActual: Date | undefined
  let baggageClaim: string | undefined

  if (now >= effArr) {
    status = 'arrived'
    departureActual = new Date(effDep)
    takeoffActual = new Date(effTakeoff)
    landingActual = new Date(effLanding)
    arrivalActual = new Date(effArr)
    baggageClaim = String(1 + (seed % 12))
  } else if (now >= effTakeoff) {
    status = 'en_route'
    departureActual = new Date(effDep)
    takeoffActual = new Date(effTakeoff)
  } else if (now >= effDep) {
    status = 'departed'
    departureActual = new Date(effDep)
  } else if (now >= effDep - 40 * 60_000) {
    status = 'boarding'
  }

  const acft = aircraftFor(blockMin, seed)
  const isIntl = blockMin >= 360

  return {
    faFlightId: `STUB-${cleanIdent}-${date}`,
    airlineIata: airline ? iata : iata,
    flightNumber: number,
    origin,
    destination,
    departureScheduled,
    departureEstimated,
    departureActual,
    arrivalScheduled,
    arrivalEstimated,
    arrivalActual,
    takeoffScheduled,
    takeoffEstimated,
    takeoffActual,
    landingScheduled,
    landingEstimated,
    landingActual,
    status,
    gateDeparture: gate(seed),
    gateArrival: gate(seed >> 3),
    terminalDeparture: String(1 + (seed % 4)),
    terminalArrival: isIntl ? String(1 + ((seed >> 2) % 5)) : String(1 + ((seed >> 2) % 4)),
    baggageClaim,
    aircraftType: acft,
    registration: airline ? airline.reg(seed) : nReg(seed),
  }
}
