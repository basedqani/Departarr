const OPENSKY_BASE = 'https://opensky-network.org/api'

export interface AircraftPosition {
  icao24: string
  callsign: string
  latitude: number
  longitude: number
  altitude: number
  velocity: number
  heading: number
  onGround: boolean
  lastContact: number
}

// IATA airline code → ICAO callsign prefix. OpenSky state vectors carry the
// ICAO callsign (e.g. "BAW178"), not the IATA flight number ("BA178"), so we
// translate before matching.
const IATA_TO_ICAO: Record<string, string> = {
  DL: 'DAL', AA: 'AAL', UA: 'UAL', WN: 'SWA', B6: 'JBU', AS: 'ASA', NK: 'NKS',
  F9: 'FFT', HA: 'HAL', G4: 'AAY', BA: 'BAW', VS: 'VIR', LH: 'DLH', AF: 'AFR',
  KL: 'KLM', NH: 'ANA', JL: 'JAL', KE: 'KAL', OZ: 'AAR', SQ: 'SIA', QF: 'QFA',
  EK: 'UAE', CX: 'CPA', AC: 'ACA', EI: 'EIN', IB: 'IBE', TK: 'THY', AM: 'AMX',
  LA: 'LAN', AY: 'FIN', SK: 'SAS', LX: 'SWR', OS: 'AUA', TP: 'TAP', EY: 'ETD',
  QR: 'QTR', SU: 'AFL', CA: 'CCA', MU: 'CES', CZ: 'CSN', JQ: 'JST', VA: 'VOZ',
}

/** Convert an IATA flight ident like "BA178" to an ICAO callsign like "BAW178". */
export function identToCallsign(ident: string): string {
  const clean = ident.toUpperCase().replace(/\s+/g, '')
  const m = clean.match(/^([A-Z]{2,3})(\d+[A-Z]?)$/)
  if (!m) return clean
  const [, code, num] = m
  const icao = IATA_TO_ICAO[code]
  return icao ? `${icao}${num}` : clean
}

// callsign → discovered icao24 hex, so subsequent polls can use the cheap
// icao24-filtered endpoint instead of scanning every aircraft in the sky.
const callsignToIcao = new Map<string, { icao24: string; ts: number }>()
const ICAO_CACHE_TTL = 6 * 60 * 60 * 1000

function toPosition(state: unknown[]): AircraftPosition | null {
  const [icao24, rawCallsign, , , lastContact, lon, lat, altitude, onGround, velocity, heading] = state as [
    string, string, string, null, number, number | null, number | null,
    number | null, boolean, number | null, number | null
  ]
  if (lat == null || lon == null) return null
  return {
    icao24: String(icao24),
    callsign: String(rawCallsign ?? '').trim(),
    latitude: lat as number,
    longitude: lon as number,
    altitude: (altitude as number) ?? 0,
    velocity: (velocity as number) ?? 0,
    heading: (heading as number) ?? 0,
    onGround: Boolean(onGround),
    lastContact: lastContact as number,
  }
}

async function fetchStates(query: string): Promise<unknown[][] | null> {
  try {
    const res = await fetch(`${OPENSKY_BASE}/states/all${query}`, {
      headers: { 'User-Agent': 'Departarr/1.0' },
      signal: AbortSignal.timeout(12_000),
    })
    if (!res.ok) return null
    const data = (await res.json()) as { states?: unknown[][] | null }
    return data.states ?? null
  } catch {
    return null
  }
}

/**
 * Resolve a live aircraft position from OpenSky (free, no key). Prefers the
 * flight ident (→ ICAO callsign match); falls back to a hex icao24 in the
 * registration field. Returns null when the flight isn't currently broadcasting
 * (e.g. on the ground / not yet departed) — that's expected, not an error.
 */
export async function getAircraftPosition(opts: {
  ident?: string
  registration?: string | null
}): Promise<AircraftPosition | null> {
  const { ident, registration } = opts

  // 1. If registration is actually a hex icao24, query it directly (cheap).
  if (registration && /^[0-9a-f]{6}$/i.test(registration)) {
    const states = await fetchStates(`?icao24=${registration.toLowerCase()}`)
    const s = states?.[0]
    return s ? toPosition(s) : null
  }

  if (!ident) return null
  const callsign = identToCallsign(ident)

  // 2. Cached icao24 for this callsign → cheap filtered query.
  const cached = callsignToIcao.get(callsign)
  if (cached && Date.now() - cached.ts < ICAO_CACHE_TTL) {
    const states = await fetchStates(`?icao24=${cached.icao24}`)
    const s = states?.[0]
    const pos = s ? toPosition(s) : null
    if (pos) return pos
    // fall through to full scan if the cached hex went stale
  }

  // 3. Full scan, match by callsign (no key needed).
  const states = await fetchStates('')
  if (!states) return null
  const match = states.find(
    (s) => Array.isArray(s) && typeof s[1] === 'string' && (s[1] as string).trim() === callsign
  )
  if (!match) return null

  const pos = toPosition(match)
  if (pos) callsignToIcao.set(callsign, { icao24: pos.icao24, ts: Date.now() })
  return pos
}
