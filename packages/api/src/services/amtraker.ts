/**
 * Amtraker v3 live train status service.
 * API docs: https://api-v3.amtraker.com/v3/trains/{num}
 * Free, no key required. Community-maintained.
 */

const AMTRAKER_BASE = 'https://api-v3.amtraker.com/v3'
const REQUEST_TIMEOUT_MS = 8_000

export interface AmtrakerStop {
  code: string
  name: string
  tz: string
  schArr: string | null
  schDep: string | null
  arr: string | null
  dep: string | null
  arrCmnt: string | null
  depCmnt: string | null
  status: string
}

export interface AmtrakerTrain {
  trainNumber: string
  trainName: string
  status: string      // normalized: "scheduled" | "en-route" | "at-station" | "arrived" | "unknown"
  trainTimely: string // e.g. "On Time", "15 minutes late"
  lat: number | null
  lon: number | null
  originCode: string
  destCode: string
  departureActual: Date | null
  arrivalActual: Date | null
  departureEstimated: Date | null
  arrivalEstimated: Date | null
  stops: AmtrakerStop[]
}

// ── Amtraker raw types ────────────────────────────────────────────────────

interface RawAmtrakerStation {
  code: string
  name: string
  tz: string
  schArr: string | null
  schDep: string | null
  arr: string | null
  dep: string | null
  arrCmnt: string | null
  depCmnt: string | null
  status: string
  bus?: boolean
}

interface RawAmtrakerTrain {
  routeName: string
  trainNum: string | number
  trainTimely: string
  trainState: string   // "Enroute" | "Station" | "Predeparture" | "Unknown"
  lat: number | null
  lon: number | null
  origCode: string
  destCode: string
  stations: RawAmtrakerStation[]
}

// ── Status normalization ──────────────────────────────────────────────────

function normalizeStatus(trainState: string): string {
  switch (trainState) {
    case 'Enroute':      return 'en-route'
    case 'Station':      return 'at-station'
    case 'Predeparture': return 'scheduled'
    case 'Unknown':      return 'unknown'
    default:             return 'unknown'
  }
}

// ── Date parsing ──────────────────────────────────────────────────────────

function parseAmtrakerDate(val: string | null | undefined): Date | null {
  if (!val) return null
  try {
    const d = new Date(val)
    return isNaN(d.getTime()) ? null : d
  } catch {
    return null
  }
}

// ── Main export ───────────────────────────────────────────────────────────

/**
 * Fetch live status for a given train number.
 * If `originCode` is provided, filters to the consist that originates there.
 * Returns null if not found or on network error (graceful degradation).
 */
export async function fetchLiveTrainStatus(
  trainNumber: string,
  originCode?: string
): Promise<AmtrakerTrain | null> {
  const url = `${AMTRAKER_BASE}/trains/${encodeURIComponent(trainNumber)}`

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  let raw: Record<string, RawAmtrakerTrain[]>
  try {
    const res = await fetch(url, { signal: controller.signal })
    if (!res.ok) {
      if (res.status === 404) return null
      throw new Error(`Amtraker returned ${res.status}`)
    }
    // Response shape: { "351": [ {...train consist...} ] }
    raw = await res.json() as Record<string, RawAmtrakerTrain[]>
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (!msg.includes('AbortError') && !msg.includes('abort')) {
      console.warn(`[amtraker] fetchLiveTrainStatus(${trainNumber}) failed:`, msg)
    }
    return null
  } finally {
    clearTimeout(timer)
  }

  // The API returns an object keyed by train number
  const trains = Object.values(raw).flat() as RawAmtrakerTrain[]
  if (trains.length === 0) return null

  // Filter by origin if provided
  let match: RawAmtrakerTrain | undefined
  if (originCode) {
    match = trains.find(t => t.origCode?.toUpperCase() === originCode.toUpperCase())
  }
  match = match ?? trains[0]
  if (!match) return null

  const stations = (match.stations ?? []).map((s): AmtrakerStop => ({
    code: s.code,
    name: s.name,
    tz: s.tz,
    schArr: s.schArr ?? null,
    schDep: s.schDep ?? null,
    arr: s.arr ?? null,
    dep: s.dep ?? null,
    arrCmnt: s.arrCmnt ?? null,
    depCmnt: s.depCmnt ?? null,
    status: s.status ?? '',
  }))

  // Extract origin and destination actual/estimated times from stations array
  const originStation = stations.find(s => s.code.toUpperCase() === match!.origCode?.toUpperCase())
  const destStation = stations.find(s => s.code.toUpperCase() === match!.destCode?.toUpperCase())

  // For departure: use 'dep' (actual) or 'schDep' as estimated
  const departureActual = parseAmtrakerDate(originStation?.dep)
  const departureEstimated = parseAmtrakerDate(originStation?.schDep)
  const arrivalActual = parseAmtrakerDate(destStation?.arr)
  const arrivalEstimated = parseAmtrakerDate(destStation?.schArr)

  return {
    trainNumber: String(match.trainNum),
    trainName: match.routeName ?? '',
    status: normalizeStatus(match.trainState ?? 'Unknown'),
    trainTimely: match.trainTimely ?? '',
    lat: match.lat ?? null,
    lon: match.lon ?? null,
    originCode: match.origCode ?? '',
    destCode: match.destCode ?? '',
    departureActual,
    arrivalActual,
    departureEstimated,
    arrivalEstimated,
    stops: stations,
  }
}
