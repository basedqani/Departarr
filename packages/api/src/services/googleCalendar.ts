import { google } from 'googleapis'
import { prisma } from '../lib/prisma.js'
import { getSettingWithEnvFallback } from '../lib/settings.js'
import { detectFlightsInEvent, extractEventDate } from './flightDetector.js'
import { lookupFlight, lookupAllFlightLegs, isActiveProviderOverBudget } from './flightAware.js'
import { detectTrainsInEvent } from './trainDetector.js'
import { lookupTrainSchedule } from './gtfs.js'
import type { FastifyRequest } from 'fastify'

type CalendarTime = { date?: string | null; dateTime?: string | null }
type CalendarEventLike = { start?: CalendarTime | null; end?: CalendarTime | null }

export interface BoardingStopInput {
  origin: string
  originName?: string | null
  departureScheduled: Date
  stops: Array<{ code: string; name: string; schDep?: string | null; schArr?: string | null }>
}
export interface BoardingResolution {
  origin: string
  originName: string | null
  departureScheduled: Date
}

/**
 * Decide which stop the user actually boards at for an auto-detected train.
 *
 * Precedence (most reliable first):
 *  1. ADDRESS — the calendar event's location maps to a concrete station code
 *     (e.g. "240 Kellogg Blvd, Saint Paul" → MSP). The booking venue *is* the
 *     boarding stop, so it wins outright. We anchor the departure to that stop's
 *     canonical scheduled instant, not the raw event time (which can be mis-zoned).
 *  2. TIME — no usable address match → pick the stop whose scheduled instant is
 *     closest to the event start (within 90 min).
 *  3. Otherwise keep the route origin, trusting the event's own start time.
 *
 * Returning address-first fixes the bug where a mis-zoned event time made the
 * time matcher pick a wrong mid-route stop and suppress the reliable address match.
 */
export function resolveBoardingStop(
  schedule: BoardingStopInput,
  boardingStation: string | undefined,
  eventStartDateTime: string | undefined,
  trainNumberForLog = '',
): BoardingResolution {
  let origin = schedule.origin
  let originName = schedule.originName ?? null
  let departureScheduled = schedule.departureScheduled

  const addressStop = boardingStation
    ? schedule.stops.find(s => s.code.toUpperCase() === boardingStation.toUpperCase())
    : undefined

  if (addressStop) {
    origin = addressStop.code
    originName = addressStop.name
    const iso = addressStop.schDep ?? addressStop.schArr
    if (iso) departureScheduled = new Date(iso)
    console.log(`[calendar] Train ${trainNumberForLog}: address-based boarding → ${origin} (${originName})`)
  } else if (eventStartDateTime) {
    const eventMs = new Date(eventStartDateTime).getTime()
    let bestStop = schedule.stops[0]
    let bestDiff = Infinity
    for (const stop of schedule.stops) {
      const iso = stop.schDep ?? stop.schArr
      if (!iso) continue
      const diff = Math.abs(new Date(iso).getTime() - eventMs)
      if (diff < bestDiff) {
        bestDiff = diff
        bestStop = stop
      }
    }
    if (bestStop && bestDiff <= 90 * 60 * 1000 && bestStop.code !== schedule.origin) {
      origin = bestStop.code
      originName = bestStop.name
      const iso = bestStop.schDep ?? bestStop.schArr
      if (iso) departureScheduled = new Date(iso)
      console.log(`[calendar] Train ${trainNumberForLog}: time-based boarding → ${origin} (${originName}), diff ${Math.round(bestDiff / 60000)}min`)
    } else {
      departureScheduled = new Date(eventStartDateTime)
    }
  }

  return { origin, originName, departureScheduled }
}

/**
 * Returns true if the event is already entirely in the past — i.e. its arrival
 * (end) time, or start time when there's no end, is before now. We do NOT import
 * such events: past items should only ever be ones that aged into Past naturally.
 */
function isEventInPast(event: CalendarEventLike): boolean {
  const end = event.end ?? null
  const start = event.start ?? null
  const ref = end?.dateTime ?? end?.date ?? start?.dateTime ?? start?.date
  if (!ref) return false
  const refMs = new Date(ref).getTime()
  if (Number.isNaN(refMs)) return false
  return refMs < Date.now()
}

async function getOAuthClient(req?: FastifyRequest) {
  const clientId = await getSettingWithEnvFallback('google_client_id', 'GOOGLE_CLIENT_ID')
  const clientSecret = await getSettingWithEnvFallback('google_client_secret', 'GOOGLE_CLIENT_SECRET')

  // Derive redirect URI from request host, with env override
  let redirectUri = process.env.GOOGLE_REDIRECT_URI
  if (!redirectUri && req) {
    const proto = (req.headers['x-forwarded-proto'] as string | undefined) ?? 'http'
    const host = req.headers.host ?? 'localhost'
    redirectUri = `${proto}://${host}/api/auth/google/callback`
  }
  redirectUri = redirectUri ?? 'http://localhost:8080/api/auth/google/callback'

  return new google.auth.OAuth2(clientId ?? undefined, clientSecret ?? undefined, redirectUri)
}

export async function getGoogleOAuthUrl(state: string, req?: FastifyRequest): Promise<string> {
  const oauth2Client = await getOAuthClient(req)
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/calendar.readonly'],
    prompt: 'consent',
    state,
  })
}

export async function exchangeCodeForTokens(userId: string, code: string, req?: FastifyRequest): Promise<void> {
  const oauth2Client = await getOAuthClient(req)
  const { tokens } = await oauth2Client.getToken(code)

  await prisma.calendarConnection.upsert({
    where: {
      // Use userId + provider as unique; handled by findFirst since no @@unique
      id: (
        await prisma.calendarConnection.findFirst({ where: { userId, provider: 'google' } })
      )?.id ?? 'new',
    },
    create: {
      userId,
      provider: 'google',
      accessToken: tokens.access_token ?? '',
      refreshToken: tokens.refresh_token ?? '',
      expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
    },
    update: {
      accessToken: tokens.access_token ?? '',
      refreshToken: tokens.refresh_token ?? '',
      expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
    },
  })
}

/**
 * Train auto-import from the calendar is DISABLED for now.
 *
 * Amtrak GTFS schedules always represent a train's FULL run from its true
 * origin (e.g. the Empire Builder #8 from Seattle), anchored to that origin's
 * departure. Reliably re-anchoring a multi-day train to the user's actual
 * mid-route boarding stop (e.g. boarding #8 at St. Paul the morning after it
 * left Seattle) is not yet solved: the time-based match is thrown off by the
 * wrong service-day anchor, and the address-based match misses because the
 * GTFS stop_id rarely equals our 3-letter station code. Auto-import therefore
 * produced wrong origins (Seattle→Chicago instead of St. Paul→Chicago).
 *
 * Until that's properly handled, trains are added MANUALLY (the manual add flow
 * has explicit Boarding/Arriving pickers and correct GTFS offset arithmetic).
 * Flip this to true to re-enable auto-import once the boarding-stop resolution
 * is robust.
 */
const ENABLE_TRAIN_AUTOSYNC = true

export interface SyncResult {
  flightsFound: number
  trainsFound: number
}

export async function syncCalendarForUser(userId: string): Promise<SyncResult> {
  const connection = await prisma.calendarConnection.findFirst({
    where: { userId, provider: 'google' },
  })
  if (!connection) return { flightsFound: 0, trainsFound: 0 }

  const oauth2Client = await getOAuthClient()
  oauth2Client.setCredentials({
    access_token: connection.accessToken,
    refresh_token: connection.refreshToken,
  })

  // Auto-refresh tokens — persist new access token as it's rotated. Wrap in a
  // try/catch so a write failure here never aborts the whole sync.
  oauth2Client.on('tokens', (tokens) => {
    prisma.calendarConnection
      .update({
        where: { id: connection.id },
        data: {
          accessToken: tokens.access_token ?? connection.accessToken,
          refreshToken: tokens.refresh_token ?? connection.refreshToken,
          expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : connection.expiresAt,
        },
      })
      .catch((err) => console.error(`Failed to persist refreshed Google token for user ${userId}:`, err))
  })

  const calendar = google.calendar({ version: 'v3', auth: oauth2Client })

  // Fetch events from 12 months back to 6 months out
  const timeMin = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString()
  const timeMax = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString()

  let pageToken: string | undefined
  let flightsAdded = 0
  let trainsAdded = 0

  // CAL-6: incremental fetch. If we have a stored syncToken, ask Google for only
  // the events changed since last sync. A syncToken request must NOT send
  // timeMin/timeMax/orderBy. On a 410 (token expired) we fall back to a full
  // windowed scan and capture a fresh token.
  let useSyncToken = !!connection.syncToken
  let nextSyncToken: string | null | undefined

  try {
    do {
      let res
      try {
        res = await calendar.events.list(
          useSyncToken
            ? {
                calendarId: 'primary',
                maxResults: 250,
                singleEvents: true,
                syncToken: connection.syncToken ?? undefined,
                pageToken,
              }
            : {
                calendarId: 'primary',
                timeMin,
                timeMax,
                maxResults: 250,
                singleEvents: true,
                orderBy: 'startTime',
                pageToken,
              },
        )
      } catch (err) {
        const status = (err as { code?: number; status?: number }).code ?? (err as { status?: number }).status
        if (useSyncToken && status === 410) {
          // Token expired — restart with a full window scan this cycle.
          console.log(`[calendar] syncToken expired for user ${userId}, falling back to full window`)
          useSyncToken = false
          pageToken = undefined
          continue
        }
        throw err
      }

      const events = res.data.items ?? []
      if (res.data.nextSyncToken) nextSyncToken = res.data.nextSyncToken

      for (const event of events) {
        // Never let a single malformed event abort the whole sync.
        try {
          const detected = detectFlightsInEvent({
            summary: event.summary,
            description: event.description,
            location: event.location,
          })

          for (const flight of detected) {
            const start = event.start
            if (!start) continue
            const date = extractEventDate(start as { date?: string; dateTime?: string })
            if (!date) continue

            // Skip events that are already entirely in the past. Use the event's
            // end (arrival) time if available, else its start time. Past items in
            // the app should only ever be ones that aged into Past naturally —
            // never freshly imported from a past calendar event.
            if (isEventInPast(event)) {
              console.log(`[calendar] flight ${flight.ident} on ${date} is in the past, skipping import`)
              continue
            }

            console.log(`[calendar] Processing flight ${flight.ident} on ${date} (event: ${event.id ?? 'no-id'})`)

            // The Google event's `updated` timestamp lets us detect edits to an
            // already-imported event (same id, new time/number). CAL-3.
            const eventUpdated = event.updated ? new Date(event.updated) : null

            // Layer 1: precise dedup by calendar event ID. If the event was
            // edited in Google Calendar since we last imported it, re-enrich by
            // deleting the stale row and falling through to a fresh lookup.
            if (event.id) {
              const byEventId = await prisma.flight.findFirst({
                where: { userId, calendarEventId: event.id },
              })
              if (byEventId) {
                const stored = byEventId.calendarEventUpdated?.getTime() ?? null
                const incoming = eventUpdated?.getTime() ?? null
                const changed = incoming !== null && incoming !== stored
                if (!changed) {
                  console.log(`[calendar] ${flight.ident} on ${date} already in DB by event ID, skipping`)
                  continue
                }
                console.log(`[calendar] ${flight.ident} on ${date} changed in GCal (updated ${event.updated}), re-enriching`)
                await prisma.flight.delete({ where: { id: byEventId.id } })
              }
            }

            // Layer 2: fallback dedup by ident + date range (catches manual vs calendar dupes)
            const dayStart = new Date(`${date}T00:00:00Z`).getTime()
            const byFlight = await prisma.flight.findFirst({
              where: {
                userId,
                ident: flight.ident,
                departureScheduled: {
                  gte: new Date(dayStart - 36 * 3600 * 1000),
                  lt:  new Date(dayStart + 60 * 3600 * 1000),
                },
              },
            })
            if (byFlight) {
              console.log(`[calendar] ${flight.ident} on ${date} already in DB by ident+date, skipping`)
              continue
            }

            try {
              const departureUtc =
                (start as { date?: string; dateTime?: string }).dateTime ?? undefined

              // CAL-1: never make a billable provider call when the active
              // provider is over its budget cap. Fall straight through to the
              // stub-save path below so the event still imports (free).
              let flightData = null
              if (await isActiveProviderOverBudget()) {
                console.log(`[calendar] ${flight.ident} on ${date}: provider over budget, saving stub (no paid call)`)
              } else if (!flight.origin && !flight.dest) {
                // CAL-2: no route hint → a single multi-leg call covers both the
                // "find the flight" and "pick the right leg" cases. Avoids the
                // old redundant lookupFlight + lookupAllFlightLegs double call.
                const allLegs = await lookupAllFlightLegs(flight.ident, date)
                if (allLegs.length === 1) {
                  flightData = allLegs[0]
                } else if (allLegs.length > 1) {
                  const matched = allLegs.find(leg =>
                    leg.departureScheduled.toISOString().substring(0, 10) === date
                  )
                  flightData = matched ?? allLegs[0]
                }
              } else {
                flightData = await lookupFlight(flight.ident, date, {
                  origin: flight.origin,
                  dest: flight.dest,
                  departureUtc,
                })
              }

              if (!flightData) {
                // AeroDataBox doesn't know about this flight yet (too far out, or
                // unrecognised flight number). Save a stub so the user can see it in
                // the UI. Do NOT use text-parsed airport codes (origin/dest from the
                // calendar event text) — these are unreliable (e.g. "fliGHT TO
                // DENpasar" produces "GHT"→"DEN"). The poller will enrich the stub
                // with real data once AeroDataBox has it.
                console.log(`[calendar] ${flight.ident} on ${date}: no AeroDataBox data, saving stub from calendar event`)
                const stubDeparture = departureUtc ? new Date(departureUtc) : new Date(`${date}T00:00:00Z`)
                // Estimate arrival as 2h after departure when we have no real data
                const stubArrival = new Date(stubDeparture.getTime() + 2 * 60 * 60 * 1000)
                await prisma.flight.create({
                  data: {
                    userId,
                    ident: flight.ident,
                    faFlightId: null,
                    airlineIata: flight.ident.match(/^([A-Z]{2})\d/)?.[1] ?? null,
                    flightNumber: flight.ident.replace(/^[A-Z]{2}/, '') ?? null,
                    origin: '',
                    destination: '',
                    departureScheduled: stubDeparture,
                    departureEstimated: null,
                    arrivalScheduled: stubArrival,
                    arrivalEstimated: null,
                    status: 'scheduled',
                    gateDeparture: null,
                    gateArrival: null,
                    terminalDeparture: null,
                    terminalArrival: null,
                    baggageClaim: null,
                    aircraftType: null,
                    registration: null,
                    calendarEventId: event.id ?? null,
                    calendarEventUpdated: eventUpdated,
                    lastPolledAt: null,
                  },
                })
                flightsAdded++
                continue
              }

              await prisma.flight.create({
                data: {
                  userId,
                  ident: flight.ident,
                  faFlightId: flightData.faFlightId ?? null,
                  airlineIata: flightData.airlineIata ?? null,
                  flightNumber: flightData.flightNumber ?? null,
                  origin: flightData.origin,
                  destination: flightData.destination,
                  departureScheduled: flightData.departureScheduled,
                  departureEstimated: flightData.departureEstimated ?? null,
                  arrivalScheduled: flightData.arrivalScheduled,
                  arrivalEstimated: flightData.arrivalEstimated ?? null,
                  status: flightData.status,
                  gateDeparture: flightData.gateDeparture ?? null,
                  gateArrival: flightData.gateArrival ?? null,
                  terminalDeparture: flightData.terminalDeparture ?? null,
                  terminalArrival: flightData.terminalArrival ?? null,
                  baggageClaim: flightData.baggageClaim ?? null,
                  aircraftType: flightData.aircraftType ?? null,
                  registration: flightData.registration ?? null,
                  calendarEventId: event.id ?? null,
                  calendarEventUpdated: eventUpdated,
                  lastPolledAt: new Date(),
                },
              })
              flightsAdded++
              console.log(`[calendar] Added flight ${flight.ident} on ${date}`)
            } catch (err) {
              const code = (err as { code?: string }).code
              if (code === 'P2002') {
                console.log(`[calendar] ${flight.ident} on ${date} already in DB (conflict), skipping`)
              } else {
                console.error(`[calendar] Failed to add flight ${flight.ident}:`, err)
              }
            }
          }
          // ── Train detection ───────────────────────────────────────────
          // Disabled — see ENABLE_TRAIN_AUTOSYNC note above. Trains are added
          // manually until mid-route boarding-stop resolution is robust.
          const detectedTrains = ENABLE_TRAIN_AUTOSYNC
            ? detectTrainsInEvent({
                summary: event.summary,
                description: event.description,
                location: event.location,
              })
            : []

          for (const detected of detectedTrains) {
            try {
              const start = event.start
              if (!start) continue
              const eventDate = extractEventDate(start as { date?: string; dateTime?: string })
              if (!eventDate) continue

              // Skip events already entirely in the past (see flight loop above).
              if (isEventInPast(event)) {
                console.log(`[calendar] train ${detected.trainNumber} on ${eventDate} is in the past, skipping import`)
                continue
              }

              console.log(`[calendar] Processing train ${detected.trainNumber} on ${eventDate} (event: ${event.id ?? 'no-id'})`)

              const eventUpdated = event.updated ? new Date(event.updated) : null

              // Layer 1: dedup by calendar event ID, with CAL-3 edit detection.
              if (event.id) {
                const existing = await prisma.train.findFirst({
                  where: { userId, calendarEventId: event.id },
                })
                if (existing) {
                  const stored = existing.calendarEventUpdated?.getTime() ?? null
                  const incoming = eventUpdated?.getTime() ?? null
                  const changed = incoming !== null && incoming !== stored
                  if (!changed) {
                    console.log(`[calendar] Train ${detected.trainNumber} on ${eventDate} already in DB by event ID, skipping`)
                    continue
                  }
                  console.log(`[calendar] Train ${detected.trainNumber} on ${eventDate} changed in GCal, re-enriching`)
                  await prisma.train.delete({ where: { id: existing.id } })
                }
              }

              // Layer 2 (CAL-7): fallback dedup by train number + date range,
              // mirroring the flight loop — catches manual vs calendar dupes.
              {
                const dayStart = new Date(`${eventDate}T00:00:00Z`).getTime()
                const byTrain = await prisma.train.findFirst({
                  where: {
                    userId,
                    trainNumber: detected.trainNumber,
                    departureScheduled: {
                      gte: new Date(dayStart - 36 * 3600 * 1000),
                      lt:  new Date(dayStart + 60 * 3600 * 1000),
                    },
                  },
                })
                if (byTrain) {
                  console.log(`[calendar] Train ${detected.trainNumber} on ${eventDate} already in DB by number+date, skipping`)
                  continue
                }
              }

              const schedule = await lookupTrainSchedule(detected.trainNumber, eventDate)
              if (!schedule) {
                // GTFS doesn't have this train — save a stub from calendar event data
                console.log(`[calendar] Train ${detected.trainNumber} on ${eventDate}: no GTFS data, saving stub from calendar event`)
                const eventStartDateTime = (start as { date?: string; dateTime?: string }).dateTime
                const stubDeparture = eventStartDateTime ? new Date(eventStartDateTime) : new Date(`${eventDate}T00:00:00Z`)
                const stubArrival = new Date(stubDeparture.getTime() + 2 * 60 * 60 * 1000)
                await prisma.train.create({
                  data: {
                    userId,
                    calendarEventId: event.id ?? null,
                    calendarEventUpdated: eventUpdated,
                    trainNumber: detected.trainNumber,
                    trainName: null,
                    origin: detected.boardingStation ?? '',
                    destination: '',
                    originName: null,
                    destinationName: null,
                    departureScheduled: stubDeparture,
                    arrivalScheduled: stubArrival,
                    stopsJson: null,
                    status: 'scheduled',
                  },
                })
                trainsAdded++
                continue
              }

              const { origin, originName, departureScheduled } = resolveBoardingStop(
                schedule,
                detected.boardingStation,
                (start as { date?: string; dateTime?: string }).dateTime,
                detected.trainNumber,
              )

              await prisma.train.create({
                data: {
                  userId,
                  calendarEventId: event.id ?? null,
                  calendarEventUpdated: eventUpdated,
                  trainNumber: schedule.trainNumber,
                  trainName: schedule.trainName ?? null,
                  origin,
                  destination: schedule.destination,
                  originName,
                  destinationName: schedule.destinationName ?? null,
                  departureScheduled,
                  arrivalScheduled: schedule.arrivalScheduled,
                  stopsJson: schedule.stops.length > 0 ? JSON.stringify(schedule.stops) : null,
                  status: 'scheduled',
                },
              })
              trainsAdded++
              console.log(`[calendar] Added train ${detected.trainNumber} on ${eventDate}`)
            } catch (err) {
              const code = (err as { code?: string }).code
              if (code === 'P2002') {
                console.log(`[calendar] Train ${detected.trainNumber} already in DB (conflict), skipping`)
              } else {
                console.error(`[calendar] Failed to add train ${detected.trainNumber}:`, err)
              }
            }
          }
        } catch (err) {
          console.error(`Failed to process calendar event ${event.id ?? '(unknown)'}:`, err)
        }
      }

      pageToken = res.data.nextPageToken ?? undefined
    } while (pageToken)
  } catch (err) {
    // Likely a token-refresh / auth failure (e.g. revoked refresh token) or an
    // API outage. Record the failure but do not throw so the scheduler keeps
    // serving other users.
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`Calendar sync failed for user ${userId}:`, msg)
    await recordSyncResult(userId, flightsAdded + trainsAdded, msg)
    return { flightsFound: flightsAdded, trainsFound: trainsAdded }
  }

  // CAL-6: persist the token Google handed back so the next sync is incremental.
  if (nextSyncToken) {
    await prisma.calendarConnection
      .update({ where: { id: connection.id }, data: { syncToken: nextSyncToken } })
      .catch((err) => console.error(`Failed to persist syncToken for user ${userId}:`, err))
  }

  await recordSyncResult(userId, flightsAdded + trainsAdded, null)
  return { flightsFound: flightsAdded, trainsFound: trainsAdded }
}

/**
 * Persist last-sync metadata per user in the Setting table. We write directly
 * via prisma.setting.upsert (rather than setSetting) because these keys are
 * dynamic per-user and not part of the typed RECOGNIZED_KEYS set.
 */
async function recordSyncResult(
  userId: string,
  count: number,
  error: string | null
): Promise<void> {
  const now = new Date().toISOString()
  try {
    await prisma.setting.upsert({
      where: { key: `calendar_last_sync_${userId}` },
      create: { key: `calendar_last_sync_${userId}`, value: now },
      update: { value: now },
    })
    await prisma.setting.upsert({
      where: { key: `calendar_last_count_${userId}` },
      create: { key: `calendar_last_count_${userId}`, value: String(count) },
      update: { value: String(count) },
    })
    await prisma.setting.upsert({
      where: { key: `calendar_last_error_${userId}` },
      create: { key: `calendar_last_error_${userId}`, value: error ?? '' },
      update: { value: error ?? '' },
    })
  } catch (err) {
    console.error(`Failed to record calendar sync metadata for user ${userId}:`, err)
  }
}
