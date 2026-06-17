/**
 * Amtraker v3 live train status service.
 * API docs: https://api-v3.amtraker.com/v3/trains/{num}
 * Free, no key required. Community-maintained.
 */

const AMTRAKER_BASE = 'https://api-v3.amtraker.com/v3'
const REQUEST_TIMEOUT_MS = 8_000
const CACHE_TTL_MS = 30_000 // live data refreshes ~every 30s upstream
const MAX_RETRIES = 2       // total attempts = MAX_RETRIES + 1

// Short per-train-number response cache to avoid hammering the upstream API when
// several requests for the same train arrive close together.
const responseCache = new Map<string, { at: number; data: Record<string, RawAmtrakerTrain[]> }>()

const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms))

/** Fetch raw Amtraker JSON for a train number, with a short cache + retry/backoff. */
async function fetchRawWithRetry(trainNumber: string): Promise<Record<string, RawAmtrakerTrain[]> | null> {
  const cached = responseCache.get(trainNumber)
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.data

  const url = `${AMTRAKER_BASE}/trains/${encodeURIComponent(trainNumber)}`

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    try {
      const res = await fetch(url, { signal: controller.signal })
      if (res.status === 404) return null
      if (!res.ok) throw new Error(`Amtraker returned ${res.status}`)
      const data = await res.json() as Record<string, RawAmtrakerTrain[]>
      responseCache.set(trainNumber, { at: Date.now(), data })
      return data
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      const aborted = msg.includes('AbortError') || msg.includes('abort')
      if (attempt < MAX_RETRIES) {
        await sleep(250 * (attempt + 1)) // linear backoff: 250ms, 500ms
        continue
      }
      if (!aborted) console.warn(`[amtraker] fetch(${trainNumber}) failed after retries:`, msg)
      return null
    } finally {
      clearTimeout(timer)
    }
  }
  return null
}

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
  bus: boolean
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
  // Response shape: { "351": [ {...train consist...} ] }
  const raw = await fetchRawWithRetry(trainNumber)
  if (!raw) return null

  // The API returns an object keyed by train number
  const trains = Object.values(raw).flat() as RawAmtrakerTrain[]
  if (trains.length === 0) return null

  // Select the correct consist (the same train number can have several active
  // runs). Preference order:
  //   1. origCode matches our boarding/origin code exactly
  //   2. ANY stop on the consist matches our code (covers mid-route boarding,
  //      where our boarding stop is not the consist's origin)
  //   3. first consist as a last resort
  let match: RawAmtrakerTrain | undefined
  if (originCode) {
    const want = originCode.toUpperCase()
    match = trains.find(t => t.origCode?.toUpperCase() === want)
    match = match ?? trains.find(t => (t.stations ?? []).some(s => s.code?.toUpperCase() === want))
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
    bus: s.bus === true,
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
