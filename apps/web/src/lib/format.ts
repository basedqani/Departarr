const AIRPORT_TZ: Record<string, string> = {
  ATL: 'America/New_York', LAX: 'America/Los_Angeles', ORD: 'America/Chicago',
  DFW: 'America/Chicago', DEN: 'America/Denver', JFK: 'America/New_York',
  SFO: 'America/Los_Angeles', SEA: 'America/Los_Angeles', LAS: 'America/Los_Angeles',
  MCO: 'America/New_York', EWR: 'America/New_York', PHX: 'America/Phoenix',
  IAH: 'America/Chicago', MIA: 'America/New_York', BOS: 'America/New_York',
  MSP: 'America/Chicago', DTW: 'America/Detroit', CLT: 'America/New_York',
  PHL: 'America/New_York', LGA: 'America/New_York', BWI: 'America/New_York',
  SLC: 'America/Denver', DCA: 'America/New_York', MDW: 'America/Chicago',
  SAN: 'America/Los_Angeles', TPA: 'America/New_York', PDX: 'America/Los_Angeles',
  HNL: 'Pacific/Honolulu', BNA: 'America/Chicago', AUS: 'America/Chicago',
  MCI: 'America/Chicago', LHR: 'Europe/London', CDG: 'Europe/Paris',
  AMS: 'Europe/Amsterdam', FRA: 'Europe/Berlin', NRT: 'Asia/Tokyo',
  HND: 'Asia/Tokyo', ICN: 'Asia/Seoul', SIN: 'Asia/Singapore',
  HKG: 'Asia/Hong_Kong', SYD: 'Australia/Sydney', DXB: 'Asia/Dubai',
  DOH: 'Asia/Qatar', YYZ: 'America/Toronto', YVR: 'America/Vancouver',
  GRU: 'America/Sao_Paulo',
}

export function getAirportTz(iata: string): string {
  return AIRPORT_TZ[iata] ?? Intl.DateTimeFormat().resolvedOptions().timeZone
}

export function formatTime(dateStr: string | null | undefined): string {
  if (!dateStr) return '--:--'
  const d = new Date(dateStr)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '---'
  const d = new Date(dateStr)
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
}

export function formatDateTime(dateStr: string | null | undefined): string {
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

export function formatDuration(ms: number): string {
  const totalMinutes = Math.floor(ms / 60_000)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours === 0) return `${minutes}m`
  if (minutes === 0) return `${hours}h`
  return `${hours}h ${minutes}m`
}

export function formatLocalTime(
  dateStr: string | null | undefined,
  tz: string | undefined,
): string {
  if (!dateStr) return '--:--'
  const d = new Date(dateStr)
  if (!tz) {
    return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })
  }
  return new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(d)
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
