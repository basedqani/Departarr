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

// Registration → ICAO24 hex is a complex mapping; OpenSky takes icao24 hex.
// For best results, store registration and look up by callsign/ident match.
// This implementation queries the entire state vector set filtered by callsign.
export async function getAircraftPosition(
  registration: string
): Promise<AircraftPosition | null> {
  // Try direct icao24 if it looks like a hex code (6 chars)
  const isHex = /^[0-9a-f]{6}$/i.test(registration)

  let url: string
  if (isHex) {
    url = `${OPENSKY_BASE}/states/all?icao24=${registration.toLowerCase()}`
  } else {
    // Query without filter, then match by callsign
    url = `${OPENSKY_BASE}/states/all?time=0`
  }

  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Departarr/1.0' },
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) return null

    const data = await res.json() as { states?: unknown[][] | null }
    if (!data.states || data.states.length === 0) return null

    let state: unknown[] | undefined

    if (isHex) {
      state = data.states[0]
    } else {
      // Match callsign (index 1) to registration (padded to 8 chars)
      const callsign = registration.toUpperCase().padEnd(8, ' ')
      state = data.states.find(
        (s) => Array.isArray(s) && typeof s[1] === 'string' && (s[1] as string).trim() === callsign.trim()
      )
    }

    if (!state || !Array.isArray(state)) return null

    const [icao24, rawCallsign, , , lastContact, lon, lat, altitude, onGround, velocity, heading] = state as [
      string, string, string, null, number, number | null, number | null,
      number | null, boolean, number | null, number | null
    ]

    if (lat == null || lon == null) return null

    return {
      icao24: icao24 as string,
      callsign: (rawCallsign as string).trim(),
      latitude: lat as number,
      longitude: lon as number,
      altitude: (altitude as number) ?? 0,
      velocity: (velocity as number) ?? 0,
      heading: (heading as number) ?? 0,
      onGround: Boolean(onGround),
      lastContact: lastContact as number,
    }
  } catch {
    return null
  }
}
