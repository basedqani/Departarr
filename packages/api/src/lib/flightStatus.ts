/**
 * Shared flight-status normalization.
 *
 * Maps raw provider status strings (FlightAware, AeroDataBox, ADSB-derived) to
 * a single canonical vocabulary used everywhere in the DB and UI.
 *
 * Canonical statuses:
 *   scheduled | boarding | departed | en_route | taxiing | arrived | cancelled | diverted
 *
 * Terminal state is `arrived` (NOT `landed`).
 */

export type CanonicalStatus =
  | 'scheduled'
  | 'boarding'
  | 'departed'
  | 'en_route'
  | 'taxiing'
  | 'arrived'
  | 'cancelled'
  | 'diverted'

export interface NormalizedStatus {
  status: CanonicalStatus
  delayed: boolean
}

/**
 * Normalize a raw status string into a canonical status + delayed flag.
 * Unknown / empty inputs fall back to `scheduled`.
 */
export function normalizeStatus(raw: string | null | undefined): NormalizedStatus {
  const s = (raw ?? '').toString().trim().toLowerCase().replace(/[\s-]+/g, '_')

  // Delay is orthogonal to the lifecycle state — detect it independently.
  const delayed = /delay/.test(s)

  // Cancellation / diversion (highest priority — terminal-ish)
  if (/cancel/.test(s)) return { status: 'cancelled', delayed }
  if (/divert/.test(s)) return { status: 'diverted', delayed }

  // Arrived / landed → canonical `arrived`
  if (/arriv|landed|gate_arrival|on_block/.test(s)) return { status: 'arrived', delayed }

  // Taxiing (taxi in/out)
  if (/taxi/.test(s)) return { status: 'taxiing', delayed }

  // En route / airborne / in flight
  if (/en_route|enroute|airborne|in_flight|in_air|cruise/.test(s)) {
    return { status: 'en_route', delayed }
  }

  // Departed / took off / off the ground
  if (/depart|took_off|takeoff|wheels_off|off_block|active/.test(s)) {
    return { status: 'departed', delayed }
  }

  // Boarding / gate
  if (/board|gate_open/.test(s)) return { status: 'boarding', delayed }

  // Scheduled / planned / on time / unknown
  if (/schedul|planned|on_time|expected|filed/.test(s)) {
    return { status: 'scheduled', delayed }
  }

  // Bare "delayed" with no other lifecycle hint → still scheduled, but delayed.
  return { status: 'scheduled', delayed }
}
