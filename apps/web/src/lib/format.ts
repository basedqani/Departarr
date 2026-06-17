import { getAirport } from './airports'

// ─── Amtrak station → IANA timezone ─────────────────────────────────────────
// NOTE: must stay in sync with the backend AMTRAK_STATION_TZ in
// packages/api/src/data/amtrakStations.ts — this is the display-side mirror.
const AMTRAK_TZ: Record<string, string> = {
  // Eastern
  NYP: 'America/New_York', WAS: 'America/New_York', PHL: 'America/New_York',
  BAL: 'America/New_York', NWK: 'America/New_York', BOS: 'America/New_York',
  BBY: 'America/New_York', PVD: 'America/New_York', NHV: 'America/New_York',
  NLC: 'America/New_York', MYS: 'America/New_York', KGN: 'America/New_York',
  RTE: 'America/New_York', TRE: 'America/New_York', MPD: 'America/New_York',
  WIL: 'America/New_York', ABE: 'America/New_York', ALB: 'America/New_York',
  HAR: 'America/New_York', LAN: 'America/New_York', SPG: 'America/New_York',
  CVS: 'America/New_York', RVR: 'America/New_York', LYH: 'America/New_York',
  RGH: 'America/New_York', GBO: 'America/New_York', HAM: 'America/New_York',
  SAB: 'America/New_York', CLT: 'America/New_York', BUF: 'America/New_York',
  ROC: 'America/New_York', SYR: 'America/New_York', UCA: 'America/New_York',
  SAR: 'America/New_York', PIT: 'America/New_York', CIN: 'America/New_York',
  DET: 'America/New_York', ANN: 'America/New_York', KAL: 'America/New_York',
  BTL: 'America/New_York', ETG: 'America/New_York', FLN: 'America/New_York',
  JAC: 'America/New_York', SAV: 'America/New_York', FLO: 'America/New_York',
  MIA: 'America/New_York', TPA: 'America/New_York', JAX: 'America/New_York',
  // Central
  CHI: 'America/Chicago', MCI: 'America/Chicago', STL: 'America/Chicago',
  CHM: 'America/Chicago', MSD: 'America/Chicago', MSP: 'America/Chicago',
  WNO: 'America/Chicago', LCR: 'America/Chicago', TOM: 'America/Chicago',
  MKE: 'America/Chicago', NOL: 'America/Chicago', SPI: 'America/Chicago',
  OKC: 'America/Chicago', TOP: 'America/Chicago', LNK: 'America/Chicago',
  OMA: 'America/Chicago', AUS: 'America/Chicago', SAT: 'America/Chicago',
  FTW: 'America/Chicago', DAL: 'America/Chicago',
  // Mountain
  DEN: 'America/Denver', GJT: 'America/Denver', GLW: 'America/Denver',
  SLC: 'America/Denver', OGD: 'America/Denver', ELP: 'America/Denver',
  // Pacific
  SEA: 'America/Los_Angeles', TAC: 'America/Los_Angeles', OLY: 'America/Los_Angeles',
  CTB: 'America/Los_Angeles', KEL: 'America/Los_Angeles', VAN: 'America/Los_Angeles',
  PDX: 'America/Los_Angeles', SAL: 'America/Los_Angeles', ALY: 'America/Los_Angeles',
  EUG: 'America/Los_Angeles', KFH: 'America/Los_Angeles', DUN: 'America/Los_Angeles',
  RDD: 'America/Los_Angeles', CKS: 'America/Los_Angeles', EMY: 'America/Los_Angeles',
  SAC: 'America/Los_Angeles', DAV: 'America/Los_Angeles', MTZ: 'America/Los_Angeles',
  SNJ: 'America/Los_Angeles', SLO: 'America/Los_Angeles', SBA: 'America/Los_Angeles',
  OXN: 'America/Los_Angeles', LAX: 'America/Los_Angeles', FUL: 'America/Los_Angeles',
  ANA: 'America/Los_Angeles', SNA: 'America/Los_Angeles', OSD: 'America/Los_Angeles',
  SAN: 'America/Los_Angeles', RNO: 'America/Los_Angeles', SPK: 'America/Los_Angeles',
}

/**
 * Resolves an Amtrak station code to an IANA timezone, or `null` if unknown.
 * IMPORTANT: never falls back to the viewer's machine timezone — callers must
 * treat `null` as "render in UTC with an explicit UTC label" so train times are
 * never silently shifted into the wrong zone.
 */
export function getAmtrakStationTz(code: string): string | null {
  return AMTRAK_TZ[code.toUpperCase()] ?? null
}

// ─── Airport → IANA timezone ──────────────────────────────────────────────────
const AIRPORT_TZ: Record<string, string> = {
  // USA — Eastern
  ATL: 'America/New_York', JFK: 'America/New_York', LGA: 'America/New_York',
  EWR: 'America/New_York', MIA: 'America/New_York', MCO: 'America/New_York',
  BOS: 'America/New_York', PHL: 'America/New_York', CLT: 'America/New_York',
  DTW: 'America/New_York', BWI: 'America/New_York', DCA: 'America/New_York',
  TPA: 'America/New_York', PIT: 'America/New_York', BUF: 'America/New_York',
  JAX: 'America/New_York', ORF: 'America/New_York', ALB: 'America/New_York',
  CVG: 'America/New_York', CMH: 'America/New_York', RDU: 'America/New_York',
  RSW: 'America/New_York', CLE: 'America/New_York',
  // USA — Central
  ORD: 'America/Chicago', DFW: 'America/Chicago', MDW: 'America/Chicago',
  IAH: 'America/Chicago', MSP: 'America/Chicago', BNA: 'America/Chicago',
  MCI: 'America/Chicago', STL: 'America/Chicago', MSY: 'America/Chicago',
  MKE: 'America/Chicago', AUS: 'America/Chicago',
  IND: 'America/Indiana/Indianapolis',
  // USA — Mountain
  DEN: 'America/Denver', SLC: 'America/Denver', PHX: 'America/Phoenix',
  // USA — Pacific
  LAX: 'America/Los_Angeles', SFO: 'America/Los_Angeles', SEA: 'America/Los_Angeles',
  LAS: 'America/Los_Angeles', PDX: 'America/Los_Angeles', SAN: 'America/Los_Angeles',
  OAK: 'America/Los_Angeles', SJC: 'America/Los_Angeles', SMF: 'America/Los_Angeles',
  // USA — Hawaii
  HNL: 'Pacific/Honolulu',
  // Canada
  YYZ: 'America/Toronto', YVR: 'America/Vancouver',
  // Europe
  LHR: 'Europe/London', CDG: 'Europe/Paris', AMS: 'Europe/Amsterdam',
  FRA: 'Europe/Berlin', MAD: 'Europe/Madrid', BCN: 'Europe/Madrid',
  FCO: 'Europe/Rome', MUC: 'Europe/Berlin', ZRH: 'Europe/Zurich',
  // Middle East
  DXB: 'Asia/Dubai', DOH: 'Asia/Qatar', AUH: 'Asia/Dubai',
  // Asia-Pacific
  SIN: 'Asia/Singapore', HKG: 'Asia/Hong_Kong', NRT: 'Asia/Tokyo',
  HND: 'Asia/Tokyo', ICN: 'Asia/Seoul', PEK: 'Asia/Shanghai',
  PVG: 'Asia/Shanghai', SYD: 'Australia/Sydney', MEL: 'Australia/Melbourne',
  BKK: 'Asia/Bangkok', KUL: 'Asia/Kuala_Lumpur', DEL: 'Asia/Kolkata',
  BOM: 'Asia/Kolkata',
  // Latin America
  GRU: 'America/Sao_Paulo', EZE: 'America/Argentina/Buenos_Aires',
  SCL: 'America/Santiago', LIM: 'America/Lima', MEX: 'America/Mexico_City',
  CUN: 'America/Cancun', GDL: 'America/Mexico_City',
}

/**
 * Resolves an airport IATA code to an IANA timezone, or `null` if unknown.
 * Primary source is the full OpenFlights airport dataset (getAirport().tz),
 * with a small hard-coded map as a last-resort fallback for codes missing a tz.
 * IMPORTANT: never falls back to the viewer's machine timezone — callers must
 * treat `null` as "render in UTC with an explicit UTC label" so flight times are
 * never silently shifted into the wrong zone.
 */
export function getAirportTz(iata: string): string | null {
  if (!iata) return null
  const code = iata.toUpperCase()
  return getAirport(code)?.tz ?? AIRPORT_TZ[code] ?? null
}

/**
 * Formats a UTC ISO string as a wall-clock time in the given IANA zone, always
 * including the zone abbreviation. When `tz` is null/undefined the time is
 * rendered in UTC with a "UTC" label — never in the viewer's machine zone — so
 * the displayed offset is always self-evident and honest.
 */
export function formatTime(
  dateStr: string | null | undefined,
  tz: string | null | undefined,
): string {
  if (!dateStr) return '--:--'
  return formatTimeInZone(dateStr, tz ?? 'UTC')
}

export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '---'
  const d = new Date(dateStr)
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
}

/**
 * Formats a UTC ISO string as a date+time in the given IANA zone, always
 * including the zone abbreviation. When `tz` is null/undefined renders in UTC
 * with a "UTC" label — never the viewer's machine zone.
 */
export function formatDateTime(
  dateStr: string | null | undefined,
  tz: string | null | undefined,
): string {
  if (!dateStr) return '---'
  const d = new Date(dateStr)
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz ?? 'UTC',
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
    hour12: true,
    timeZoneName: 'short',
  }).formatToParts(d)
  return parts.map(p => p.value).join('')
}

/**
 * Viewer-local date+time for genuine audit timestamps (e.g. the Share page event
 * log) where the viewer's own clock is the correct frame of reference. This is
 * the ONLY formatter that intentionally uses the machine timezone — do NOT use
 * it for flight/train times.
 */
export function formatDateTimeLocal(dateStr: string | null | undefined): string {
  if (!dateStr) return '---'
  const d = new Date(dateStr)
  return d.toLocaleString([], {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

export function timeAgo(dateStr: string | null | undefined): string {
  if (!dateStr) return ''
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

/** Formats a delay in minutes as "+1h 49m" (positive) or "-1h 49m" (negative). Returns "" for 0. */
export function formatDelay(minutes: number): string {
  if (minutes === 0) return ''
  const sign = minutes > 0 ? '+' : '-'
  const abs = Math.abs(minutes)
  const h = Math.floor(abs / 60)
  const m = abs % 60
  if (h === 0) return `${sign}${m}m`
  if (m === 0) return `${sign}${h}h`
  return `${sign}${h}h ${m}m`
}

export function formatDuration(ms: number): string {
  const totalMinutes = Math.floor(ms / 60_000)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours === 0) return `${minutes}m`
  if (minutes === 0) return `${hours}h`
  return `${hours}h ${minutes}m`
}

/**
 * Formats a UTC ISO string into a human-readable time in the given IANA timezone,
 * including the short timezone abbreviation (e.g. "9:00 PM CDT").
 */
export function formatTimeInZone(
  dateStr: string | null | undefined,
  tz: string | null | undefined,
): string {
  if (!dateStr) return '--:--'
  const d = new Date(dateStr)
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz ?? 'UTC',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZoneName: 'short',
  }).formatToParts(d)
  const time = parts
    .filter(p => p.type === 'hour' || p.type === 'literal' || p.type === 'minute' || p.type === 'dayPeriod')
    .map(p => p.value)
    .join('')
    .trim()
  const tzAbbr = parts.find(p => p.type === 'timeZoneName')?.value ?? ''
  return tzAbbr ? `${time} ${tzAbbr}` : time
}

/**
 * Formats a UTC ISO string as a wall-clock flight/train time, always including
 * the zone abbreviation so the offset is self-evident. When `tz` is
 * null/undefined the time renders in UTC with a "UTC" label — NEVER in the
 * viewer's machine zone. This guarantees a 4:30 PM departure never silently
 * appears as 6:30 PM just because the data lacked a tz.
 */
export function formatLocalTime(
  dateStr: string | null | undefined,
  tz: string | null | undefined,
): string {
  if (!dateStr) return '--:--'
  return formatTimeInZone(dateStr, tz ?? 'UTC')
}

/**
 * Returns the calendar day (YYYY-MM-DD) of a Date as observed in `tz`.
 * Used to compute "tomorrow"/"in N days" relative to the FLIGHT's origin zone
 * rather than the viewer's machine calendar.
 */
function calendarDayInZone(date: Date, tz: string): string {
  // en-CA yields ISO-ish YYYY-MM-DD which sorts/parses cleanly.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date)
}

/**
 * Human-readable relative day ("tomorrow", "in 3 days", or a weekday/date),
 * computed in the given IANA zone. When `tz` is null/undefined, UTC is used as a
 * stable fallback — never the viewer's machine zone — so the relative day stays
 * consistent with the displayed wall-clock time.
 */
export function formatRelativeDayInZone(
  target: Date,
  now: Date,
  tz: string | null | undefined,
): string {
  const zone = tz ?? 'UTC'
  const targetDay = calendarDayInZone(target, zone)
  const todayDay = calendarDayInZone(now, zone)
  // Diff in whole days between two YYYY-MM-DD strings (UTC-anchored to avoid DST).
  const dayDiff = Math.round(
    (Date.parse(targetDay + 'T00:00:00Z') - Date.parse(todayDay + 'T00:00:00Z')) / 86400_000,
  )
  if (dayDiff === 1) return 'tomorrow'
  if (dayDiff > 1 && dayDiff < 7) return `in ${dayDiff} days`
  return new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    weekday: 'short', month: 'short', day: 'numeric',
  }).format(target)
}

/** Returns a human-readable offset difference string like "Tokyo is 16h ahead" or null if unknown/same. */
export function formatTzShift(
  originTz: string | undefined,
  destTz: string | undefined,
  refDateStr: string,
  destCity: string,
): string | null {
  if (!originTz || !destTz || originTz === destTz) return null
  try {
    const ref = new Date(refDateStr)
    const getOffsetMin = (tz: string): number => {
      // Parse the offset of a timezone at the reference date
      const fmt = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        timeZoneName: 'shortOffset',
      })
      const parts = fmt.formatToParts(ref)
      const offsetPart = parts.find(p => p.type === 'timeZoneName')?.value ?? 'GMT+0'
      // offsetPart is like "GMT+5:30" or "GMT-4"
      const m = offsetPart.match(/GMT([+-])(\d+)(?::(\d+))?/)
      if (!m) return 0
      const sign = m[1] === '+' ? 1 : -1
      return sign * (parseInt(m[2]) * 60 + parseInt(m[3] ?? '0'))
    }
    const originOff = getOffsetMin(originTz)
    const destOff = getOffsetMin(destTz)
    const diffMin = destOff - originOff
    if (diffMin === 0) return null
    const diffH = diffMin / 60
    const absH = Math.abs(diffH)
    const label = Number.isInteger(diffH)
      ? `${absH}h`
      : `${Math.floor(absH)}h ${Math.abs(diffMin % 60)}m`
    return `${destCity} is ${label} ${diffH > 0 ? 'ahead' : 'behind'}`
  } catch {
    return null
  }
}
