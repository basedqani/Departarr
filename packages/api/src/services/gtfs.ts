/**
 * Amtrak GTFS service.
 *
 * Downloads and caches the Amtrak GTFS static zip from the official Amtrak
 * content CDN, refreshing it every 7 days.  Parses routes, trips, calendar,
 * stops, and stop_times to build a full schedule for a given train number on
 * a given date.
 *
 * GTFS times can exceed 24:00:00 (overnight trains); this is handled.
 */

import { createWriteStream, existsSync, mkdirSync, statSync, createReadStream } from 'fs'
import { join } from 'path'
import { pipeline } from 'stream/promises'
import { createGunzip } from 'zlib'
import { tmpdir } from 'os'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { readFile } from 'fs/promises'
import { getAmtrakStationTzBackend } from '../data/amtrakStations.js'

const execFileAsync = promisify(execFile)

const GTFS_URL = 'https://content.amtrak.com/content/gtfs/GTFS.zip'
const CACHE_DIR = process.env.GTFS_CACHE_DIR ?? join(tmpdir(), 'amtrak_gtfs')
const CACHE_ZIP = join(CACHE_DIR, 'GTFS.zip')
const CACHE_EXTRACTED = join(CACHE_DIR, 'extracted')
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

// ── Types ─────────────────────────────────────────────────────────────────

export interface GtfsStop {
  code: string
  name: string
  lat: number
  lon: number
  scheduledArr?: string // HH:MM:SS (may be > 24h)
  scheduledDep?: string
  stopSequence: number
}

export interface TrainSchedule {
  trainNumber: string
  trainName: string
  origin: string
  destination: string
  originName: string
  destinationName: string
  departureScheduled: Date
  arrivalScheduled: Date
  stops: GtfsStop[]
}

// ── CSV helpers ───────────────────────────────────────────────────────────

function parseCSV(text: string): Record<string, string>[] {
  const lines = text.replace(/\r/g, '').split('\n').filter(Boolean)
  if (lines.length < 2) return []
  const headers = lines[0].split(',').map(h => h.trim())
  return lines.slice(1).map(line => {
    // Handle quoted fields
    const values: string[] = []
    let current = ''
    let inQuotes = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (ch === '"') {
        inQuotes = !inQuotes
      } else if (ch === ',' && !inQuotes) {
        values.push(current.trim())
        current = ''
      } else {
        current += ch
      }
    }
    values.push(current.trim())
    const row: Record<string, string> = {}
    headers.forEach((h, i) => { row[h] = values[i] ?? '' })
    return row
  })
}

async function readGtfsFile(filename: string): Promise<Record<string, string>[]> {
  const filePath = join(CACHE_EXTRACTED, filename)
  if (!existsSync(filePath)) return []
  const text = await readFile(filePath, 'utf-8')
  return parseCSV(text)
}

// ── Download & extraction ─────────────────────────────────────────────────

async function downloadGtfs(): Promise<void> {
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true })

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 60_000)
  try {
    const res = await fetch(GTFS_URL, { signal: controller.signal })
    if (!res.ok) throw new Error(`GTFS download failed: ${res.status} ${res.statusText}`)
    const arrayBuffer = await res.arrayBuffer()
    const { writeFile } = await import('fs/promises')
    await writeFile(CACHE_ZIP, Buffer.from(arrayBuffer))
  } finally {
    clearTimeout(timer)
  }
}

async function extractGtfs(): Promise<void> {
  if (!existsSync(CACHE_EXTRACTED)) mkdirSync(CACHE_EXTRACTED, { recursive: true })

  // Try platform unzip first, fall back to Node.js built-in yauzl-compatible approach
  try {
    if (process.platform === 'win32') {
      // PowerShell's Expand-Archive
      await execFileAsync('powershell', [
        '-NoProfile', '-Command',
        `Expand-Archive -Force -Path '${CACHE_ZIP}' -DestinationPath '${CACHE_EXTRACTED}'`,
      ], { timeout: 60_000 })
    } else {
      await execFileAsync('unzip', ['-o', CACHE_ZIP, '-d', CACHE_EXTRACTED], { timeout: 60_000 })
    }
  } catch {
    // Fallback: use Node's built-in to unzip (manual ZIP parsing)
    await extractZipFallback()
  }
}

/**
 * Minimal ZIP extractor that only handles stored or deflated entries.
 * Used as a fallback when the system unzip command is unavailable.
 */
async function extractZipFallback(): Promise<void> {
  const { readFile: rf, writeFile: wf } = await import('fs/promises')
  const zipBuffer = await rf(CACHE_ZIP)

  let offset = 0
  while (offset < zipBuffer.length - 4) {
    const sig = zipBuffer.readUInt32LE(offset)
    if (sig !== 0x04034b50) break // Local file header signature

    const compression = zipBuffer.readUInt16LE(offset + 8)
    const compressedSize = zipBuffer.readUInt32LE(offset + 18)
    const fileNameLength = zipBuffer.readUInt16LE(offset + 26)
    const extraLength = zipBuffer.readUInt16LE(offset + 28)
    const fileName = zipBuffer.subarray(offset + 30, offset + 30 + fileNameLength).toString('utf-8')

    const dataOffset = offset + 30 + fileNameLength + extraLength
    const compressedData = zipBuffer.subarray(dataOffset, dataOffset + compressedSize)

    if (!fileName.endsWith('/')) {
      let data: Buffer
      if (compression === 0) {
        data = compressedData
      } else if (compression === 8) {
        const { inflateRaw } = await import('zlib')
        const { promisify: p } = await import('util')
        data = await p(inflateRaw)(compressedData)
      } else {
        data = compressedData // unsupported, skip
      }
      const outPath = join(CACHE_EXTRACTED, fileName.replace(/\//g, '/'))
      const outDir = outPath.substring(0, outPath.lastIndexOf('/'))
      if (outDir && !existsSync(outDir)) mkdirSync(outDir, { recursive: true })
      await wf(outPath, data)
    }

    offset = dataOffset + compressedSize
  }
}

// Ensure GTFS data is fresh; download + extract if needed
let ensurePromise: Promise<void> | null = null

async function ensureGtfsFresh(): Promise<void> {
  // Singleton: if another call is already fetching, wait for it
  if (ensurePromise) return ensurePromise

  const doEnsure = async (): Promise<void> => {
    let needDownload = true
    if (existsSync(CACHE_ZIP)) {
      const stat = statSync(CACHE_ZIP)
      if (Date.now() - stat.mtimeMs < MAX_AGE_MS) needDownload = false
    }

    if (needDownload) {
      console.log('[gtfs] Downloading Amtrak GTFS...')
      await downloadGtfs()
      await extractGtfs()
      console.log('[gtfs] GTFS download and extraction complete')
    } else if (!existsSync(join(CACHE_EXTRACTED, 'trips.txt'))) {
      console.log('[gtfs] Extracting cached GTFS zip...')
      await extractGtfs()
    }
  }

  ensurePromise = doEnsure().finally(() => { ensurePromise = null })
  return ensurePromise
}

// ── Date helpers ──────────────────────────────────────────────────────────

/**
 * Parse a GTFS date string (YYYYMMDD) to a JS Date (midnight UTC).
 * Used only for calendar range comparisons (not for stop time arithmetic).
 */
function parseGtfsDate(s: string): Date {
  const year = parseInt(s.substring(0, 4), 10)
  const month = parseInt(s.substring(4, 6), 10) - 1
  const day = parseInt(s.substring(6, 8), 10)
  return new Date(Date.UTC(year, month, day))
}

/**
 * Returns the UTC timestamp of midnight (00:00:00) in the given IANA timezone
 * on the given YYYY-MM-DD date. This is the correct base for GTFS time arithmetic
 * because GTFS times are local clock times at the origin station, not UTC offsets.
 *
 * Technique: format noon UTC in the target timezone to get the local clock reading,
 * then subtract those hours/minutes/seconds to find the UTC moment of local midnight.
 */
function localMidnightUtc(dateStr: string, tz: string): Date {
  const [year, month, day] = dateStr.split('-').map(Number)
  // Use noon UTC as reference — safely within the same calendar day in any timezone
  const noonUtc = new Date(Date.UTC(year, month - 1, day, 12, 0, 0))
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(noonUtc)
  const h = parseInt(parts.find(p => p.type === 'hour')?.value ?? '12')
  const m = parseInt(parts.find(p => p.type === 'minute')?.value ?? '0')
  const sec = parseInt(parts.find(p => p.type === 'second')?.value ?? '0')
  // noonUtc minus (local clock reading of noon) gives local midnight in UTC
  return new Date(noonUtc.getTime() - (h * 3600 + m * 60 + sec) * 1000)
}

/**
 * Get day-of-week field name for a JS Date (UTC day).
 */
function dowField(date: Date): string {
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
  return days[date.getUTCDay()]
}

/**
 * Parse a GTFS time string like "14:30:00" or "25:30:00" into milliseconds
 * from midnight.
 */
function parseGtfsTime(s: string): number {
  const parts = s.split(':')
  const h = parseInt(parts[0], 10)
  const m = parseInt(parts[1], 10)
  const sec = parseInt(parts[2] ?? '0', 10)
  return (h * 3600 + m * 60 + sec) * 1000
}

/**
 * Given a base date (local midnight in the origin station's timezone) and a GTFS
 * time string (which may exceed 24:00:00 for overnight trains), returns the actual
 * UTC datetime.
 */
function gtfsTimeToDate(baseMidnightLocal: Date, timeStr: string): Date {
  const msFromMidnight = parseGtfsTime(timeStr)
  return new Date(baseMidnightLocal.getTime() + msFromMidnight)
}

// ── Main export ───────────────────────────────────────────────────────────

/** Build the service-runs-on-date map for one candidate date. */
async function buildServiceMap(
  calendarRaw: Record<string, string>[],
  calendarDatesRaw: Record<string, string>[],
  dateObj: Date,
  dateCompact: string,
): Promise<Map<string, boolean>> {
  const map = new Map<string, boolean>()
  for (const row of calendarRaw) {
    const start = parseGtfsDate(row.start_date)
    const end = parseGtfsDate(row.end_date)
    if (dateObj < start || dateObj > end) { map.set(row.service_id, false); continue }
    map.set(row.service_id, row[dowField(dateObj)] === '1')
  }
  for (const row of calendarDatesRaw) {
    if (row.date !== dateCompact) continue
    map.set(row.service_id, parseInt(row.exception_type, 10) === 1)
  }
  return map
}

export async function lookupTrainSchedule(
  trainNumber: string,
  date: string // YYYY-MM-DD — may be the user's boarding date, not the train's departure date
): Promise<TrainSchedule | null> {
  try {
    await ensureGtfsFresh()
  } catch (err) {
    console.error('[gtfs] Failed to ensure GTFS data:', err)
    return null
  }

  try {
    // 1. Find route(s) by trip_short_name = trainNumber
    const tripsRaw = await readGtfsFile('trips.txt')
    const matchingTrips = tripsRaw.filter(t => t.trip_short_name === trainNumber)
    if (matchingTrips.length === 0) return null

    // Build route_id -> route_long_name map
    const routesRaw = await readGtfsFile('routes.txt')
    const routeNameMap = new Map<string, string>()
    for (const r of routesRaw) {
      routeNameMap.set(r.route_id, r.route_long_name ?? '')
    }

    const calendarRaw = await readGtfsFile('calendar.txt')
    const calendarDatesRaw = await readGtfsFile('calendar_dates.txt')

    // 2. Try the user's date AND the day before.
    // Multi-day trains (Empire Builder, Coast Starlight…) depart the origin station one
    // calendar day before a mid-route boarding stop. GTFS keys the service to the
    // origin-departure date, so if the user provides their boarding date (day N) the
    // correct GTFS service may only exist on day N-1.
    const candidates: Array<{ serviceDate: string; validTrip: Record<string,string> }> = []
    for (let delta = 0; delta <= 1; delta++) {
      const d = new Date(date + 'T00:00:00Z')
      d.setUTCDate(d.getUTCDate() - delta)
      const ds = d.toISOString().substring(0, 10)
      const dc = ds.replace(/-/g, '')
      const map = await buildServiceMap(calendarRaw, calendarDatesRaw, d, dc)
      const trip = matchingTrips.find(t => map.get(t.service_id) === true)
      if (trip) candidates.push({ serviceDate: ds, validTrip: trip })
    }
    if (candidates.length === 0) return null

    // 3. Load stops once (shared between candidates)
    const stopsRaw = await readGtfsFile('stops.txt')
    const stopMap = new Map<string, { name: string; lat: number; lon: number }>()
    for (const s of stopsRaw) {
      stopMap.set(s.stop_id, { name: s.stop_name ?? s.stop_id, lat: parseFloat(s.stop_lat) || 0, lon: parseFloat(s.stop_lon) || 0 })
    }
    const stopTimesRaw = await readGtfsFile('stop_times.txt')

    // 4. Pick the best candidate: prefer the one whose origin departure is on or before the
    //    user's requested date (i.e. the trip that is actually running on the user's date).
    //    If both qualify, prefer the one with the later origin departure (day N is better than N-1
    //    when both have a service — means the user's date is the actual departure date).
    let chosen: { serviceDate: string; validTrip: Record<string,string>; firstDep: Date } | null = null
    const userDateObj = new Date(date + 'T00:00:00Z')

    for (const { serviceDate, validTrip } of candidates) {
      const tripStopTimes = stopTimesRaw
        .filter(st => st.trip_id === validTrip.trip_id)
        .sort((a, b) => parseInt(a.stop_sequence, 10) - parseInt(b.stop_sequence, 10))
      if (tripStopTimes.length < 2) continue

      const firstStop = tripStopTimes[0]
      const originId = firstStop.stop_id
      const originTzCandidate = getAmtrakStationTzBackend(originId)
      const baseMidnight = localMidnightUtc(serviceDate, originTzCandidate)
      const firstDepMs = parseGtfsTime(firstStop.departure_time || firstStop.arrival_time)
      const firstDepDate = new Date(baseMidnight.getTime() + firstDepMs)

      // The origin departure must be on or before the user's date (not in the future relative to day end)
      const userDayEnd = new Date(userDateObj.getTime() + 24 * 60 * 60 * 1000)
      if (firstDepDate >= userDayEnd) continue // this departure is AFTER the user's date — skip

      if (!chosen || firstDepDate > chosen.firstDep) {
        chosen = { serviceDate, validTrip, firstDep: firstDepDate }
      }
    }

    if (!chosen) return null

    const { serviceDate, validTrip } = chosen
    const trainName = routeNameMap.get(validTrip.route_id) ?? validTrip.trip_headsign ?? ''

    // 5. Load stop times for the chosen trip
    const tripStopTimes = stopTimesRaw
      .filter(st => st.trip_id === validTrip.trip_id)
      .sort((a, b) => parseInt(a.stop_sequence, 10) - parseInt(b.stop_sequence, 10))

    if (tripStopTimes.length < 2) return null

    const firstStop = tripStopTimes[0]
    const lastStop = tripStopTimes[tripStopTimes.length - 1]

    const origin = firstStop.stop_id
    const destination = lastStop.stop_id
    const originInfo = stopMap.get(origin)
    const destInfo = stopMap.get(destination)

    // Use the origin station's local timezone as the base for GTFS time arithmetic.
    // GTFS times are local clock times, not UTC offsets — e.g. Empire Builder departs
    // Seattle at 18:10 PST on service date June 26, stored as "18:10:00". Using the
    // user's boarding date (June 27) as the midnight base would produce times 24h off.
    const originTz = getAmtrakStationTzBackend(origin)
    const baseMidnightLocal = localMidnightUtc(serviceDate, originTz)

    const departureScheduled = gtfsTimeToDate(baseMidnightLocal, firstStop.departure_time || firstStop.arrival_time)
    const arrivalScheduled = gtfsTimeToDate(baseMidnightLocal, lastStop.arrival_time || lastStop.departure_time)

    const stops: GtfsStop[] = tripStopTimes.map(st => {
      const info = stopMap.get(st.stop_id)
      return {
        code: st.stop_id,
        name: info?.name ?? st.stop_id,
        lat: info?.lat ?? 0,
        lon: info?.lon ?? 0,
        scheduledArr: st.arrival_time || undefined,
        scheduledDep: st.departure_time || undefined,
        stopSequence: parseInt(st.stop_sequence, 10),
      }
    })

    return {
      trainNumber,
      trainName,
      origin,
      destination,
      originName: originInfo?.name ?? origin,
      destinationName: destInfo?.name ?? destination,
      departureScheduled,
      arrivalScheduled,
      stops,
    }
  } catch (err) {
    console.error('[gtfs] Error looking up train schedule:', err)
    return null
  }
}
