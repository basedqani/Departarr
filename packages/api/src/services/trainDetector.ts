/**
 * Pure utility for detecting Amtrak train references in calendar event text.
 * Side-effect-free and unit-testable.
 */

// ── Known Amtrak train names ───────────────────────────────────────────────

const AMTRAK_TRAIN_NAMES = [
  'Wolverine', 'Cardinal', 'Capitol Limited', 'Lake Shore Limited',
  'Empire Builder', 'California Zephyr', 'Coast Starlight', 'Acela',
  'Northeast Regional', 'Crescent', 'Silver Star', 'Silver Meteor',
  'Palmetto', 'Vermonter', 'Cascades', 'Sunset Limited', 'Texas Eagle',
  'City of New Orleans', 'Southwest Chief', 'Pacific Surfliner',
  'Carolinian', 'Piedmont', 'Keystone', 'Pennsylvanian', 'San Joaquins',
  'Maple Leaf', 'Heartland Flyer', 'Adirondack', 'Downeaster',
  'Blue Water', 'Pere Marquette', 'Empire Service',
]

// Sorted longest-first to match before substrings
const SORTED_TRAIN_NAMES = [...AMTRAK_TRAIN_NAMES].sort((a, b) => b.length - a.length)

// Keywords that hint at Amtrak/train context
const AMTRAK_KEYWORDS = [
  'amtrak', 'train', 'rail', 'railway', 'railroad', 'station',
  'superliner', 'viewliner', 'coach', 'sleeper', 'roomette',
  'dining car', 'observation', 'platform', 'departure', 'arrival',
  'reservation', 'ticket', 'conductor',
]

export interface DetectedTrain {
  trainNumber: string
  rawMatch: string
  boardingStation?: string  // Amtrak station code if we can detect where they're boarding
}

// ── Station detection ─────────────────────────────────────────────────────

// Maps city names, station names, and partial street addresses to Amtrak codes.
// Keyed lowercase for case-insensitive matching.
const STATION_HINTS: Record<string, string> = {
  // Street address fragments
  'kellogg': 'STP',        // 214 Kellogg Blvd E, St. Paul
  'canal st': 'NOL',       // New Orleans
  '30th st': 'PHL',
  'union station': '',      // too ambiguous alone — need city context
  'penn station': 'NYP',
  'penn st': 'NYP',

  // City / neighborhood names → Amtrak code
  'saint paul': 'STP',
  'st. paul': 'STP',
  'st paul': 'STP',
  'minneapolis': 'MSP',
  'chicago': 'CHI',
  'new york': 'NYP',
  'washington': 'WAS',
  'washington dc': 'WAS',
  'boston': 'BOS',
  'philadelphia': 'PHL',
  'los angeles': 'LAX',
  'san francisco': 'EMY',
  'emeryville': 'EMY',
  'oakland': 'OKJ',
  'seattle': 'SEA',
  'portland': 'PDX',
  'new orleans': 'NOL',
  'miami': 'MIA',
  'orlando': 'ORL',
  'atlanta': 'ATL',
  'charlotte': 'CLT',
  'raleigh': 'RGH',
  'richmond': 'RVR',
  'baltimore': 'BAL',
  'newark': 'NWK',
  'providence': 'PVD',
  'new haven': 'NHV',
  'hartford': 'HDN',
  'springfield': 'SPG',
  'albany': 'ALB',
  'buffalo': 'BUF',
  'rochester': 'ROC',
  'syracuse': 'SYR',
  'pittsburgh': 'PIT',
  'cleveland': 'CLE',
  'toledo': 'TOL',
  'detroit': 'DET',
  'ann arbor': 'ARB',
  'kalamazoo': 'KAL',
  'milwaukee': 'MKE',
  'kansas city': 'KCY',
  'st. louis': 'STL',
  'saint louis': 'STL',
  'st louis': 'STL',
  'denver': 'DEN',
  'salt lake city': 'SLC',
  'reno': 'RNO',
  'sacramento': 'SAC',
  'san jose': 'SJC',
  'san diego': 'SAN',
  'santa barbara': 'SBA',
  'tucson': 'TUS',
  'el paso': 'ELP',
  'san antonio': 'SAT',
  'austin': 'AUS',
  'dallas': 'DAL',
  'fort worth': 'FTW',
  'oklahoma city': 'OKC',
  'albuquerque': 'ABQ',
  'flagstaff': 'FLG',
  'spokane': 'SPK',
  'portland or': 'PDX',
  'tacoma': 'TAC',
  'olympia': 'OLY',
}

/**
 * Try to extract a boarding station code from calendar event text.
 * Checks location field first (most reliable), then description/summary.
 */
export function detectBoardingStation(event: {
  summary?: string | null
  description?: string | null
  location?: string | null
}): string | undefined {
  const fields = [event.location, event.description, event.summary].filter(Boolean) as string[]

  for (const field of fields) {
    const lower = field.toLowerCase()
    // Check longest matches first to avoid "st" matching inside "street"
    const sortedKeys = Object.keys(STATION_HINTS).sort((a, b) => b.length - a.length)
    for (const hint of sortedKeys) {
      if (lower.includes(hint) && STATION_HINTS[hint]) {
        return STATION_HINTS[hint]
      }
    }
  }
  return undefined
}

// ── Detection ─────────────────────────────────────────────────────────────

/**
 * Detect Amtrak train numbers from free text.
 * Returns deduplicated list of { trainNumber, rawMatch }.
 */
export function detectTrainsInText(text: string): DetectedTrain[] {
  if (!text) return []

  const results: DetectedTrain[] = []
  const upper = text.toUpperCase()

  // Check for Amtrak context
  const hasAmtrakKeyword = AMTRAK_KEYWORDS.some(kw => upper.includes(kw.toUpperCase()))
  const hasTrainName = SORTED_TRAIN_NAMES.some(name => upper.includes(name.toUpperCase()))

  if (!hasAmtrakKeyword && !hasTrainName) return []

  // Pattern 1: "Amtrak 351", "Amtrak #351", "Amtrak No. 351", "Amtrak: 8 Empire Builder"
  const amtrakNumRe = /\bAmtrak\s*:?\s*(?:#|No\.?\s*|Number\s*)?(\d{1,4})\b/gi
  let m: RegExpExecArray | null
  while ((m = amtrakNumRe.exec(text)) !== null) {
    results.push({ trainNumber: m[1], rawMatch: m[0] })
  }

  // Pattern 2: "Train 351", "Train No. 351", "Train #351"
  const trainNumRe = /\bTrain\s+(?:No\.?\s*|Number\s*|#\s*)?(\d{1,4})\b/gi
  while ((m = trainNumRe.exec(text)) !== null) {
    results.push({ trainNumber: m[1], rawMatch: m[0] })
  }

  // Pattern 3: "#351" in an Amtrak context
  if (hasAmtrakKeyword || hasTrainName) {
    const hashNumRe = /#(\d{1,4})\b/g
    while ((m = hashNumRe.exec(text)) !== null) {
      results.push({ trainNumber: m[1], rawMatch: m[0] })
    }
  }

  // Pattern 4: Known train names — also try to extract a nearby number
  for (const name of SORTED_TRAIN_NAMES) {
    const nameRe = new RegExp(`\\b${name.replace(/\s+/g, '\\s+')}\\b`, 'gi')
    let nameMatch: RegExpExecArray | null
    while ((nameMatch = nameRe.exec(text)) !== null) {
      // Look for a 1-4 digit number within 40 chars of the train name
      const context = text.substring(
        Math.max(0, nameMatch.index - 40),
        nameMatch.index + nameMatch[0].length + 40
      )
      const nearbyNum = /\b(\d{1,4})\b/.exec(context)
      if (nearbyNum) {
        results.push({ trainNumber: nearbyNum[1], rawMatch: `${name} ${nearbyNum[1]}` })
      }
    }
  }

  // Deduplicate by trainNumber
  const seen = new Set<string>()
  return results.filter(r => {
    if (seen.has(r.trainNumber)) return false
    seen.add(r.trainNumber)
    return true
  })
}

export function detectTrainsInEvent(event: {
  summary?: string | null
  description?: string | null
  location?: string | null
}): DetectedTrain[] {
  const combined = [event.summary, event.description, event.location]
    .filter(Boolean)
    .join(' ')
  const trains = detectTrainsInText(combined)
  const boardingStation = detectBoardingStation(event)
  // Attach the boarding station to every detected train from this event
  if (boardingStation) {
    return trains.map(t => ({ ...t, boardingStation }))
  }
  return trains
}
