// Pure utility functions for detecting flight references in calendar events.
// All functions are side-effect-free and unit-testable.

export interface DetectedFlight {
  ident: string
  airlineCode: string
  flightNumber: string
  rawMatch: string
}

// Regex matching airline codes (IATA 2-char: letters, or mixed letter+digit)
// followed by optional space and 1-4 digit flight number
const FLIGHT_IDENT_RE = /\b([A-Z]{2}|[A-Z]\d|\d[A-Z])\s?(\d{1,4})\b/g

// Keywords that suggest a travel/flight context
const FLIGHT_KEYWORDS = [
  'flight', 'fly', 'depart', 'arrive', 'airline', 'airport',
  'boarding', 'gate', 'terminal', 'layover', 'connection',
  'itinerary', 'confirmation', 'travel',
]

// Common IATA airport codes to help confirm context
const AIRPORT_CODE_RE = /\b([A-Z]{3})\b/g

const KNOWN_IATA_PREFIXES = new Set([
  'AA', 'AS', 'B6', 'DL', 'F9', 'G4', 'HA', 'NK', 'SY', 'UA', 'WN', 'WS',
  'AC', 'AF', 'AZ', 'BA', 'EK', 'EY', 'IB', 'JL', 'KE', 'KL', 'LH', 'LX',
  'NH', 'NZ', 'OS', 'QF', 'QR', 'SQ', 'SU', 'TG', 'TK', 'UA', 'VS', 'VX',
  '9E', 'MQ', 'OH', 'OO', 'YV', 'YX', 'ZW',
])

export function detectFlightsInText(text: string): DetectedFlight[] {
  const results: DetectedFlight[] = []
  const upperText = text.toUpperCase()

  const hasFlightKeyword = FLIGHT_KEYWORDS.some((kw) =>
    upperText.includes(kw.toUpperCase())
  )

  // Count airport-looking codes
  const airportMatches = [...upperText.matchAll(AIRPORT_CODE_RE)]
  const hasAirportCodes = airportMatches.length >= 2

  if (!hasFlightKeyword && !hasAirportCodes) return results

  let match: RegExpExecArray | null
  FLIGHT_IDENT_RE.lastIndex = 0
  while ((match = FLIGHT_IDENT_RE.exec(upperText)) !== null) {
    const airlineCode = match[1]
    const flightNumber = match[2]
    // Prefer known IATA prefixes but don't require them if keywords are present
    if (KNOWN_IATA_PREFIXES.has(airlineCode) || hasFlightKeyword) {
      results.push({
        ident: `${airlineCode}${flightNumber}`,
        airlineCode,
        flightNumber,
        rawMatch: match[0],
      })
    }
  }

  // Deduplicate by ident
  const seen = new Set<string>()
  return results.filter((f) => {
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
