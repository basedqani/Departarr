// Pure utility functions for detecting flight references in calendar events.
// All functions are side-effect-free and unit-testable.

export interface DetectedFlight {
  ident: string
  airlineCode: string
  flightNumber: string
  rawMatch: string
  origin?: string
  dest?: string
}

// Regex matching airline codes (IATA 2-char: letters, or mixed letter+digit)
// optionally preceded by the word "flight", followed by optional space and a
// 1-4 digit flight number. The leading boundary requires the char before the
// code to be a non-alphanumeric so we don't slice the tail off a longer word.
const FLIGHT_IDENT_RE = /(?<![A-Z0-9])([A-Z]{2}|[A-Z]\d|\d[A-Z])\s?(\d{1,4})(?![A-Z0-9])/g

// Keywords that suggest a travel/flight context.
const FLIGHT_KEYWORDS = [
  'flight', 'fly', 'depart', 'arrive', 'arrival', 'airline', 'airport',
  'boarding', 'gate', 'terminal', 'layover', 'connection', 'connecting',
  'itinerary', 'confirmation', 'travel', 'nonstop', 'pnr', 'seat',
  'operated by', 'carrier', 'cabin', 'economy', 'business class', 'first class',
  'check-in', 'checkin', 'booking ref', 'reservation', 'eticket', 'e-ticket',
  'ticket number', 'record locator',
]

// Airport-looking codes: a 3-letter token that is a standalone word.
const AIRPORT_CODE_RE = /\b[A-Z]{3}\b/g

// Route pattern: two 3-letter codes joined by a direction token.
const ROUTE_RE = /\b([A-Z]{3})\b\s*(?:TO|→|->|–|—|›|>|-)\s*\b([A-Z]{3})\b/

// Common IATA airline prefixes — used as a strong positive signal.
const KNOWN_IATA_PREFIXES = new Set([
  // North America
  'AA', 'AS', 'B6', 'DL', 'F9', 'G4', 'HA', 'NK', 'SY', 'UA', 'WN', 'WS',
  'AC', 'VX',
  // Regional/commuter US
  '9E', 'MQ', 'OH', 'OO', 'YV', 'YX', 'ZW',
  // Europe
  'AF', 'AZ', 'BA', 'IB', 'KL', 'LH', 'LX', 'OS', 'SU', 'VS',
  'AY', 'BT', 'FR', 'HV', 'LO', 'OK', 'OU', 'PC', 'PS', 'RO',
  'SK', 'SN', 'TK', 'TO', 'TP', 'U2', 'VY', 'W6',
  // Middle East & Africa
  'EK', 'EY', 'GF', 'MS', 'QR', 'RJ', 'AT', 'ET', 'KQ', 'SA', 'WB',
  // Asia-Pacific
  'AI', 'AK', 'BI', 'BR', 'CA', 'CI', 'CX', 'CZ', 'D7', 'FD',
  'FJ', 'GA', 'JL', 'JQ', 'KE', 'MH', 'MU', 'NH', 'NZ', 'OZ',
  'PR', 'QF', 'SQ', 'TG', 'TR', 'UL', 'VA', 'VN', 'VT',
  // Other
  'JP', 'PK',
])

// US state abbreviations — when followed by a number these are almost always
// addresses ("CA 90210") rather than flights, so we exclude them.
const US_STATE_ABBR = new Set([
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID',
  'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS',
  'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK',
  'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV',
  'WI', 'WY', 'DC',
])

// Non-airline two-letter tokens that frequently precede numbers in calendars
// but are never flight codes.
const NOISE_PREFIXES = new Set(['ID', 'PO', 'PM', 'AM', 'NO', 'RM'])

// Tokens that, when they form the rawMatch, indicate a non-flight context such
// as time strings ("AT 10", "BY 5"). Combined with the noise set above.
function isLikelyFalsePositive(
  airlineCode: string,
  flightNumber: string,
  isKnownAirline: boolean
): boolean {
  // Address-style "<STATE> <zip>" — a 5-digit number after a state abbr.
  if (US_STATE_ABBR.has(airlineCode) && !isKnownAirline) {
    if (flightNumber.length === 5) return true
    // Generic state-then-number (e.g. "CA 200") is ambiguous; reject unless the
    // code is also a known airline prefix.
    return true
  }

  if (NOISE_PREFIXES.has(airlineCode) && !isKnownAirline) return true

  // Flight numbers are 1-4 digits; a leading-zero 4-digit number like "0000"
  // is meaningless.
  if (/^0+$/.test(flightNumber)) return true

  return false
}

// Strip clock times (e.g. "10:30", "9:05 AM", "14:00-15:30") so their digits
// can't be mistaken for flight numbers, while preserving overall token layout.
function stripTimeStrings(text: string): string {
  return text.replace(/\b\d{1,2}:\d{2}(?::\d{2})?\s?(?:AM|PM)?\b/gi, ' ')
}

export function detectFlightsInText(text: string): DetectedFlight[] {
  const results: DetectedFlight[] = []
  const upperText = stripTimeStrings(text.toUpperCase())

  const hasFlightKeyword = FLIGHT_KEYWORDS.some((kw) =>
    upperText.includes(kw.toUpperCase())
  )

  // Count airport-looking codes (3-letter standalone tokens).
  const airportMatches = [...upperText.matchAll(AIRPORT_CODE_RE)]
  const hasAirportCodes = airportMatches.length >= 2

  // Require genuine flight context before extracting anything.
  if (!hasFlightKeyword && !hasAirportCodes) return results

  // Collect all route matches with their positions for per-flight lookup.
  const allRouteMatches: Array<{ index: number; origin: string; dest: string }> = []
  const routeReGlobal = /\b([A-Z]{3})\b\s*(?:TO|→|->|–|—|›|>|-)\s*\b([A-Z]{3})\b/g
  let rm: RegExpExecArray | null
  while ((rm = routeReGlobal.exec(upperText)) !== null) {
    allRouteMatches.push({ index: rm.index, origin: rm[1], dest: rm[2] })
  }

  // Helper: find the closest route match within 200 chars of a given position.
  function closestRoute(pos: number): { origin: string; dest: string } | null {
    let best: { index: number; origin: string; dest: string } | null = null
    let bestDist = Infinity
    for (const r of allRouteMatches) {
      const dist = Math.abs(r.index - pos)
      if (dist <= 200 && dist < bestDist) {
        bestDist = dist
        best = r
      }
    }
    // Fall back to the first global match if nothing nearby.
    return best ?? allRouteMatches[0] ?? null
  }

  let match: RegExpExecArray | null
  FLIGHT_IDENT_RE.lastIndex = 0
  while ((match = FLIGHT_IDENT_RE.exec(upperText)) !== null) {
    const airlineCode = match[1]
    const flightNumber = match[2]
    const isKnownAirline = KNOWN_IATA_PREFIXES.has(airlineCode)

    if (isLikelyFalsePositive(airlineCode, flightNumber, isKnownAirline)) {
      continue
    }

    // Accept when: the prefix is a known airline (strong signal), OR there is a
    // genuine flight keyword in the surrounding text (so plausible but unknown
    // carriers are still captured). Bare 2+ airport codes without a keyword are
    // not enough to accept an *unknown* carrier code (too noisy).
    if (isKnownAirline || hasFlightKeyword) {
      const route = closestRoute(match.index)
      results.push({
        ident: `${airlineCode}${flightNumber}`,
        airlineCode,
        flightNumber,
        rawMatch: match[0],
        origin: route?.origin,
        dest: route?.dest,
      })
    }
  }

  // Deduplicate by ident (route is already attached per-flight above).
  const seen = new Set<string>()
  return results
    .filter((f) => {
      if (seen.has(f.ident)) return false
      seen.add(f.ident)
      return true
    })
}

export function detectFlightsInEvent(event: {
  summary?: string | null
  description?: string | null
  location?: string | null
}): DetectedFlight[] {
  const combined = [event.summary, event.description, event.location]
    .filter(Boolean)
    .join(' ')
  return detectFlightsInText(combined)
}

/** Extract a date string (YYYY-MM-DD) from a Google Calendar event's start */
export function extractEventDate(start: {
  date?: string
  dateTime?: string
}): string | null {
  if (start.date) return start.date
  if (start.dateTime) return start.dateTime.substring(0, 10)
  return null
}
