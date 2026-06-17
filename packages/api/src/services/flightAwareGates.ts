import { readFileSync } from 'fs'
import { createRequire } from 'module'
import { getSetting, getSettingWithEnvFallback } from '../lib/settings.js'
import { incrementUsage } from '../lib/apiBudget.js'

const AEROAPI_BASE = 'https://aeroapi.flightaware.com/aeroapi'

export interface GateEnrichment {
  gateDeparture?: string
  gateArrival?: string
  terminalDeparture?: string
  terminalArrival?: string
  baggageClaim?: string
  estimatedOut?: Date    // estimated pushback from gate
  actualOut?: Date       // actual pushback from gate (gate-out / OUT)
  estimatedIn?: Date     // estimated arrival at gate
  actualIn?: Date        // actual arrival at gate (gate-in / IN)
  actualOff?: Date       // wheels off
  actualOn?: Date        // wheels on
  status?: string
}

/**
 * Resolve the FlightAware API key consistently with the poller: DB setting
 * first (`flightaware_api_key`), then env (`FLIGHTAWARE_API_KEY`). A DB-only key
 * is enough to enable enrichment.
 */
async function resolveFlightAwareKey(): Promise<string | null> {
  return getSettingWithEnvFallback('flightaware_api_key', 'FLIGHTAWARE_API_KEY').catch(
    () => process.env.FLIGHTAWARE_API_KEY ?? null,
  )
}

/**
 * Returns true if a FlightAware key is configured (DB setting OR env var).
 * Async so it matches the poller's `getSettingWithEnvFallback` resolution —
 * a DB-only key enables enrichment.
 */
export async function hasFlightAwareKey(): Promise<boolean> {
  return !!(await resolveFlightAwareKey())
}

/** Returns true for stub/demo flight ids that must never hit the real AeroAPI. */
function isStubFaFlightId(faFlightId: string): boolean {
  return (
    faFlightId.startsWith('STUB-') ||
    faFlightId.startsWith('ADB:') ||
    /mock/i.test(faFlightId)
  )
}

/** Returns true if mock mode is active (env var OR admin DB setting) */
export async function isMockMode(): Promise<boolean> {
  if (process.env.FLIGHT_DATA_MODE === 'MOCK') return true
  const dbVal = await getSetting('flight_data_mode').catch(() => null)
  return dbVal === 'MOCK'
}

function parseDateOrUndefined(value: string | null | undefined): Date | undefined {
  if (!value) return undefined
  const d = new Date(value)
  return isNaN(d.getTime()) ? undefined : d
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapFlightToEnrichment(flight: Record<string, any>): GateEnrichment {
  return {
    gateDeparture: flight.gate_orig ?? undefined,
    gateArrival: flight.gate_dest ?? undefined,
    terminalDeparture: flight.terminal_orig ?? undefined,
    terminalArrival: flight.terminal_dest ?? undefined,
    baggageClaim: flight.baggage_claim ?? undefined,
    estimatedOut: parseDateOrUndefined(flight.estimated_out),
    actualOut: parseDateOrUndefined(flight.actual_out),
    estimatedIn: parseDateOrUndefined(flight.estimated_in),
    actualIn: parseDateOrUndefined(flight.actual_in),
    actualOff: parseDateOrUndefined(flight.actual_off),
    actualOn: parseDateOrUndefined(flight.actual_on),
    status: flight.status ?? undefined,
  }
}

/** Returns mock gate enrichment from the bundled mock_flight.json */
export function fetchGateEnrichmentMock(): GateEnrichment | null {
  try {
    // Works in both CommonJS and ESM contexts at runtime
    let mockPath: string
    try {
      // ESM: use import.meta.url if available
      const metaUrl = new Function('return import.meta.url')() as string
      mockPath = new URL('../data/mock_flight.json', metaUrl).pathname
      // On Windows the pathname starts with /C:/..., strip leading slash
      if (/^\/[A-Za-z]:\//.test(mockPath)) {
        mockPath = mockPath.slice(1)
      }
    } catch {
      // CommonJS fallback
      const require = createRequire(__filename)
      mockPath = require.resolve('../data/mock_flight.json')
    }
    const raw = readFileSync(mockPath, 'utf-8')
    const json = JSON.parse(raw) as { flights: Record<string, unknown>[] }
    const flight = json.flights?.[0]
    if (!flight) return null
    return mapFlightToEnrichment(flight as Record<string, unknown>)
  } catch (err) {
    console.error('[flightAwareGates] Failed to load mock data:', err)
    return null
  }
}

/**
 * Fetches gate/terminal/baggage data from FlightAware AeroAPI v4.
 * This is ONE API call ($0.005). Only call when explicitly triggered.
 *
 * @param faFlightId - FlightAware flight ID (e.g. "AAL123-1718000000-airline-0123")
 *                     OR ident+date string (e.g. "AA123/20240615") if no FA ID
 */
export async function fetchGateEnrichment(
  faFlightId: string,
  apiKey?: string
): Promise<GateEnrichment | null> {
  if (await isMockMode()) {
    return fetchGateEnrichmentMock()
  }

  // DE-11: never make a real AeroAPI call for stub/demo/mock flight ids.
  if (isStubFaFlightId(faFlightId)) {
    return null
  }

  const key = apiKey ?? (await resolveFlightAwareKey())
  if (!key) {
    console.warn('[flightAwareGates] No API key available; skipping gate enrichment')
    return null
  }

  // DE-1: this is a billable AeroAPI call ($0.005). Count it BEFORE the fetch so
  // we meter even on error — keeps enrichment spend visible to the budget meter.
  await incrementUsage('aeroapi')

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 8000)

  try {
    // Detect ident/date format (e.g. "AA123/20240615") — no dashes except the slash
    const isIdentDate = /^[A-Z0-9]+\/\d{8}$/.test(faFlightId)

    let url: string
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let flight: Record<string, any> | null = null

    if (isIdentDate) {
      const [ident, date] = faFlightId.split('/')
      // YYYY-MM-DD from YYYYMMDD
      const dateFormatted = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`
      url = `${AEROAPI_BASE}/flights/${encodeURIComponent(ident)}`
      const res = await fetch(url, {
        headers: { 'x-apikey': key },
        signal: controller.signal,
      })
      if (!res.ok) {
        console.error(`[flightAwareGates] AeroAPI error ${res.status} for ${url}`)
        return null
      }
      const json = (await res.json()) as { flights?: Record<string, unknown>[] }
      // Filter by date prefix
      flight = json.flights?.find((f) => {
        const out = (f.scheduled_out as string | undefined) ?? ''
        return out.startsWith(dateFormatted)
      }) as Record<string, unknown> | null ?? null
    } else {
      url = `${AEROAPI_BASE}/flights/${encodeURIComponent(faFlightId)}`
      const res = await fetch(url, {
        headers: { 'x-apikey': key },
        signal: controller.signal,
      })
      if (!res.ok) {
        console.error(`[flightAwareGates] AeroAPI error ${res.status} for ${url}`)
        return null
      }
      const json = (await res.json()) as { flights?: Record<string, unknown>[] }
      flight = json.flights?.[0] as Record<string, unknown> | null ?? null
    }

    if (!flight) {
      console.warn('[flightAwareGates] No flight found in AeroAPI response')
      return null
    }

    return mapFlightToEnrichment(flight)
  } catch (err) {
    if ((err as { name?: string }).name === 'AbortError') {
      console.error('[flightAwareGates] Request timed out after 8s')
    } else {
      console.error('[flightAwareGates] Fetch error:', err)
    }
    return null
  } finally {
    clearTimeout(timeout)
  }
}
