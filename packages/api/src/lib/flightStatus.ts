// ─────────────────────────────────────────────────────────────────────────────
// Shared flight-status vocabulary.
//
// Both providers (AeroDataBox + FlightAware) speak slightly different status
// dialects, and FlightAware in particular emits *compound* strings such as
// "Taxiing / Delayed" or "En Route / Delayed". This module is the single source
// of truth that maps any raw provider string onto one canonical base state plus
// a separate `delayed` flag — never a mashed single value.
//
// AC: a normalized status NEVER contains "/" or "_" beyond the canonical set,
// and the two providers produce identical vocabulary.
//
// NOTE (cross-epic): the dual-engine orchestrator will import this module. Keep
// it dependency-free and pure.
// ─────────────────────────────────────────────────────────────────────────────

/** Canonical flight states. `landed` is reconciled to the single terminal
 *  `arrived` state (see NOTE-7) so the arrival transition can't double-fire. */
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
  /** Canonical base state — one of CanonicalStatus. Never contains "/". */
  status: CanonicalStatus
  /** True if the raw string signalled a delay (compound or explicit). */
  delayed: boolean
}

/**
 * Normalize ANY raw provider status string into a canonical base state plus a
 * separate delay flag. Decomposes compound FlightAware strings like
 * "Taxiing / Delayed" into { status: 'taxiing', delayed: true }.
 */
export function normalizeStatus(raw: string | undefined | null): NormalizedStatus {
  const lower = (raw ?? '').toLowerCase().trim()

  // Compound strings come through as "base / modifier" (FlightAware) or with
  // underscores from previous lowercasing. Split on "/" and "_" and inspect.
  // Collapse internal whitespace per part so "en route" → "enroute".
  const parts = lower.split(/[/_]/).map((p) => p.replace(/\s+/g, '')).filter(Boolean)

  // A delay can be expressed as its own token ("delayed") in a compound string.
  const delayed = parts.some((p) => p === 'delayed' || p === 'delay')

  // Find the first part that maps to a real base state.
  for (const part of parts) {
    const mapped = mapBase(part)
    if (mapped) return { status: mapped, delayed }
  }

  // Whole-string fallthrough (e.g. multi-word "gate closed" with no separator).
  const collapsed = lower.replace(/[\s/_]+/g, '')
  const mappedCollapsed = mapBase(collapsed)
  if (mappedCollapsed) return { status: mappedCollapsed, delayed }

  // A bare "delayed" with no base state → treat as still scheduled, delayed.
  return { status: 'scheduled', delayed }
}

/** Map a single (already-trimmed, lowercased) token to a canonical base, or
 *  undefined if it isn't a recognised base state. */
function mapBase(s: string): CanonicalStatus | undefined {
  switch (s) {
    case 'expected':
    case 'scheduled':
    case 'planned':
    case 'filed':
    case 'delayed':           // handled as flag, but as a bare base → scheduled
    case 'delay':
      return s === 'delayed' || s === 'delay' ? undefined : 'scheduled'

    case 'checkin':
    case 'boarding':
      return 'boarding'

    case 'gateclosed':
    case 'departed':
    case 'pushedback':
    case 'pushback':
    case 'out':
      return 'departed'

    case 'taxiing':
    case 'taxis':
    case 'taxi':
      return 'taxiing'

    case 'enroute':
    case 'airborne':
    case 'inair':
    case 'approaching':
    case 'off':
      return 'en_route'

    // Terminal arrival — reconcile `landed` → `arrived` (NOTE-7).
    case 'landed':
    case 'arrived':
    case 'on':
    case 'in':
    case 'gatearrival':
      return 'arrived'

    case 'canceled':
    case 'cancelled':
    case 'canceleduncertain':
      return 'cancelled'

    case 'diverted':
    case 'redirected':
      return 'diverted'

    default:
      return undefined
  }
}
