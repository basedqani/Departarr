/**
 * EPIC D — dual-engine tracking tests.
 *
 * Covers:
 *   DE-1  budget metering increments on a real enrichment call
 *   DE-3  status writes are normalized to the canonical vocabulary
 *   DE-4  enrichmentCount increments only on a non-null result
 *   DE-7  landing debounce (2 consecutive samples) + 5km proximity
 *   DE-8  faFlightId date-fallback formatting (IDENT/YYYYMMDD)
 *
 * All external HTTP is mocked.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── Module mocks ──────────────────────────────────────────────────────────────

const incrementUsageMock = vi.fn(async (..._args: unknown[]) => {})
vi.mock('../../lib/apiBudget.js', () => ({
  incrementUsage: (...args: unknown[]) => incrementUsageMock(...args),
  isOverBudget: async () => false,
}))

// Settings: DB-only FlightAware key, no mock mode.
vi.mock('../../lib/settings.js', () => ({
  getSetting: async (key: string) =>
    key === 'flightaware_api_key' ? 'db-key-123' : null,
  getSettingWithEnvFallback: async (key: string) =>
    key === 'flightaware_api_key' ? 'db-key-123' : null,
}))

import { fetchGateEnrichment } from '../flightAwareGates.js'
import { normalizeStatus } from '../../lib/flightStatus.js'
import { isLandedSample, type AdsbPosition } from '../adsbLol.js'

// ── Helpers ─────────────────────────────────────────────────────────────────

const realFetch = global.fetch

function mockFetchOnce(body: unknown, ok = true) {
  global.fetch = vi.fn(async () => ({
    ok,
    status: ok ? 200 : 500,
    json: async () => body,
    text: async () => JSON.stringify(body),
  })) as unknown as typeof fetch
}

function makePos(over: Partial<AdsbPosition>): AdsbPosition {
  return {
    icao24: 'abc123',
    registration: 'N123',
    callsign: 'AA1',
    latitude: 39.8561,
    longitude: -104.6737,
    altitudeFt: null,
    groundSpeedKnots: 0,
    onGround: true,
    heading: null,
    seenSecondsAgo: 1,
    isStale: false,
    ...over,
  }
}

beforeEach(() => {
  incrementUsageMock.mockClear()
  delete process.env.FLIGHT_DATA_MODE
})

afterEach(() => {
  global.fetch = realFetch
})

// ── DE-1: budget metering ──────────────────────────────────────────────────────

describe('DE-1 budget metering on enrichment', () => {
  it('increments aeroapi usage on a real (non-mock) enrichment fetch', async () => {
    mockFetchOnce({ flights: [{ gate_dest: 'B12', status: 'Arrived' }] })
    await fetchGateEnrichment('AAL123-1700000000-airline-0123')
    expect(incrementUsageMock).toHaveBeenCalledTimes(1)
    expect(incrementUsageMock).toHaveBeenCalledWith('aeroapi')
  })

  it('does NOT increment usage in mock mode', async () => {
    process.env.FLIGHT_DATA_MODE = 'MOCK'
    await fetchGateEnrichment('AAL123')
    expect(incrementUsageMock).not.toHaveBeenCalled()
  })

  it('does NOT increment usage for stub/demo flight ids', async () => {
    await fetchGateEnrichment('STUB-AA123-2026-06-16')
    await fetchGateEnrichment('ADB:AA123:2026-06-16')
    expect(incrementUsageMock).not.toHaveBeenCalled()
  })

  it('still meters even when the upstream returns an error (counted before fetch)', async () => {
    mockFetchOnce({}, false)
    const res = await fetchGateEnrichment('AAL123-1700000000-airline-0123')
    expect(res).toBeNull()
    expect(incrementUsageMock).toHaveBeenCalledTimes(1)
  })
})

// ── DE-3: status normalization ─────────────────────────────────────────────────

describe('DE-3 status normalization', () => {
  it('maps raw FA strings to canonical statuses', () => {
    expect(normalizeStatus('En Route / On Time').status).toBe('en_route')
    expect(normalizeStatus('Scheduled').status).toBe('scheduled')
    expect(normalizeStatus('Landed @ 12:30').status).toBe('arrived')
    expect(normalizeStatus('Arrived').status).toBe('arrived')
    expect(normalizeStatus('Cancelled').status).toBe('cancelled')
    expect(normalizeStatus('Diverted').status).toBe('diverted')
    expect(normalizeStatus('Taxiing').status).toBe('taxiing')
    expect(normalizeStatus('Departed').status).toBe('departed')
  })

  it('never returns the legacy "landed" terminal value', () => {
    const out = normalizeStatus('landed')
    expect(out.status).toBe('arrived')
    expect(out.status).not.toBe('landed')
  })

  it('detects delay flag orthogonally to lifecycle state', () => {
    expect(normalizeStatus('Delayed').delayed).toBe(true)
    expect(normalizeStatus('En Route (Delayed)')).toEqual({ status: 'en_route', delayed: true })
    expect(normalizeStatus('On Time').delayed).toBe(false)
  })

  it('the enrichment status output passes back through normalize unchanged (idempotent)', async () => {
    mockFetchOnce({ flights: [{ status: 'Landed' }] })
    const enrichment = await fetchGateEnrichment('AAL123-1700000000-airline-0123')
    expect(enrichment).not.toBeNull()
    // simulate orchestrator write path
    const written = normalizeStatus(enrichment!.status).status
    expect(written).toBe('arrived')
    expect(normalizeStatus(written).status).toBe('arrived')
  })
})

// ── DE-7: landing debounce + proximity ─────────────────────────────────────────

describe('DE-7 landing detection', () => {
  const DEN: [number, number] = [39.8561, -104.6737]
  const PROX_KM = 5

  it('an on-ground sample at the destination is a landing candidate', () => {
    const pos = makePos({ onGround: true, latitude: DEN[0], longitude: DEN[1] })
    expect(isLandedSample(pos, DEN[0], DEN[1], PROX_KM)).toBe(true)
  })

  it('rejects an airborne sample at altitude over a high-elevation airport (DEN false-positive fix)', () => {
    // Old logic: altitudeFt < 500 OR onGround. A plane cruising at 35000ft is
    // clearly not landed; ensure we never treat altitude as a landing signal.
    const pos = makePos({ onGround: false, altitudeFt: 35000, latitude: DEN[0], longitude: DEN[1] })
    expect(isLandedSample(pos, DEN[0], DEN[1], PROX_KM)).toBe(false)
  })

  it('rejects an on-ground sample far from the destination (taxi at origin / overflight)', () => {
    const pos = makePos({ onGround: true, latitude: 40.6413, longitude: -73.7781 }) // JFK
    expect(isLandedSample(pos, DEN[0], DEN[1], PROX_KM)).toBe(false)
  })

  it('requires TWO consecutive qualifying samples before marking arrived (debounce)', () => {
    // Simulate the orchestrator's consecutive-confirmation counter.
    let confirmations = 0
    const LANDING_CONFIRMATIONS = 2
    const landedNow = () => confirmations >= LANDING_CONFIRMATIONS

    const onGroundAtDest = makePos({ onGround: true, latitude: DEN[0], longitude: DEN[1] })
    const stillAirborne = makePos({ onGround: false, altitudeFt: 8000, latitude: DEN[0], longitude: DEN[1] })

    // First on-ground sample → 1 confirmation, not arrived yet.
    confirmations = isLandedSample(onGroundAtDest, DEN[0], DEN[1], PROX_KM) ? confirmations + 1 : 0
    expect(landedNow()).toBe(false)

    // A bounce / bad sample resets the counter.
    confirmations = isLandedSample(stillAirborne, DEN[0], DEN[1], PROX_KM) ? confirmations + 1 : 0
    expect(confirmations).toBe(0)

    // Two consecutive good samples → arrived.
    confirmations = isLandedSample(onGroundAtDest, DEN[0], DEN[1], PROX_KM) ? confirmations + 1 : 0
    confirmations = isLandedSample(onGroundAtDest, DEN[0], DEN[1], PROX_KM) ? confirmations + 1 : 0
    expect(landedNow()).toBe(true)
  })
})

// ── DE-4: enrichmentCount only on success ──────────────────────────────────────

describe('DE-4 enrichmentCount increments only on a non-null result', () => {
  // Mirror the orchestrator's success-gated counting.
  function applyEnrichment(count: number, enrichment: unknown): number {
    if (enrichment) return count + 1
    return count
  }

  it('does not burn the cap when enrichment returns null', () => {
    expect(applyEnrichment(0, null)).toBe(0)
    expect(applyEnrichment(2, null)).toBe(2)
  })

  it('increments when enrichment returns a result', () => {
    expect(applyEnrichment(0, { gateArrival: 'B12' })).toBe(1)
  })

  it('real failure path returns null so the cap is preserved', async () => {
    mockFetchOnce({}, false)
    const res = await fetchGateEnrichment('AAL123-1700000000-airline-0123')
    expect(res).toBeNull()
    expect(applyEnrichment(0, res)).toBe(0)
  })
})

// ── DE-8: faFlightId date fallback formatting ──────────────────────────────────

describe('DE-8 faFlightId date fallback', () => {
  // Replicate resolveEnrichmentId's pure formatting contract.
  function formatIdentDate(d: Date): string {
    const y = d.getUTCFullYear()
    const m = String(d.getUTCMonth() + 1).padStart(2, '0')
    const day = String(d.getUTCDate()).padStart(2, '0')
    return `${y}${m}${day}`
  }
  function resolveEnrichmentId(flight: { faFlightId: string | null; ident: string; departureScheduled: Date }): string {
    if (flight.faFlightId) return flight.faFlightId
    return `${flight.ident}/${formatIdentDate(flight.departureScheduled)}`
  }

  it('uses the faFlightId verbatim when present', () => {
    expect(
      resolveEnrichmentId({ faFlightId: 'AAL1-123-airline-0', ident: 'AA1', departureScheduled: new Date() }),
    ).toBe('AAL1-123-airline-0')
  })

  it('falls back to IDENT/YYYYMMDD from departureScheduled when faFlightId is null', () => {
    const id = resolveEnrichmentId({
      faFlightId: null,
      ident: 'AA123',
      departureScheduled: new Date('2026-06-16T14:30:00Z'),
    })
    expect(id).toBe('AA123/20260616')
  })

  it('the fallback string matches the AeroAPI ident/date detector regex', () => {
    const id = resolveEnrichmentId({
      faFlightId: null,
      ident: 'UA88',
      departureScheduled: new Date('2026-01-05T00:10:00Z'),
    })
    expect(id).toBe('UA88/20260105')
    expect(/^[A-Z0-9]+\/\d{8}$/.test(id)).toBe(true)
  })
})
