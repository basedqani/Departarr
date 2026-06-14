import { google } from 'googleapis'
import { prisma } from '../lib/prisma.js'
import { getSettingWithEnvFallback } from '../lib/settings.js'
import { detectFlightsInEvent, extractEventDate } from './flightDetector.js'
import { lookupFlight, lookupAllFlightLegs } from './flightAware.js'
import { detectTrainsInEvent } from './trainDetector.js'
import { lookupTrainSchedule } from './gtfs.js'
import type { FastifyRequest } from 'fastify'

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

export async function syncCalendarForUser(userId: string): Promise<number> {
  const connection = await prisma.calendarConnection.findFirst({
    where: { userId, provider: 'google' },
  })
  if (!connection) return 0

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

  try {
    do {
      const res = await calendar.events.list({
        calendarId: 'primary',
        timeMin,
        timeMax,
        maxResults: 250,
        singleEvents: true,
        orderBy: 'startTime',
        pageToken,
      })

      const events = res.data.items ?? []

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

            // Layer 1: precise dedup by calendar event ID
            if (event.id) {
              const byEventId = await prisma.flight.findFirst({
                where: { userId, calendarEventId: event.id },
              })
              if (byEventId) continue
            }

            // Only import upcoming flights — past flights must be added manually
            const flightDate = new Date(date + 'T23:59:59Z')
            if (flightDate < new Date()) continue

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
            if (byFlight) continue

            try {
              const departureUtc =
                (start as { date?: string; dateTime?: string }).dateTime ?? undefined

              let flightData = await lookupFlight(flight.ident, date, {
                origin: flight.origin,
                dest: flight.dest,
                departureUtc,
              })

              // If no route hint was available and lookupFlight returned nothing,
              // try fetching all legs and pick the one matching the date.
              if (!flightData && !flight.origin && !flight.dest) {
                const allLegs = await lookupAllFlightLegs(flight.ident, date)
                if (allLegs.length === 0) {
                  flightData = null
                } else if (allLegs.length === 1) {
                  flightData = allLegs[0]
                } else {
                  const matched = allLegs.find(leg =>
                    leg.departureScheduled.toISOString().substring(0, 10) === date
                  )
                  flightData = matched ?? allLegs[0]
                }
              }

              if (!flightData) {
                // No AeroDataBox data — skip entirely. Past flights are blocked
                // above; for future flights this means the flight isn't
                // recognised yet (too far out) — don't create a stub.
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
                  lastPolledAt: new Date(),
                },
              })
              flightsAdded++
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
          const detectedTrains = detectTrainsInEvent({
            summary: event.summary,
            description: event.description,
            location: event.location,
          })

          for (const detected of detectedTrains) {
            try {
              const start = event.start
              if (!start) continue
              const eventDate = extractEventDate(start as { date?: string; dateTime?: string })
              if (!eventDate) continue

              // Only import upcoming trains
              const trainDate = new Date(eventDate + 'T23:59:59Z')
              if (trainDate < new Date()) continue

              // Dedup by calendar event ID
              if (event.id) {
                const existing = await prisma.train.findFirst({
                  where: { userId, calendarEventId: event.id },
                })
                if (existing) continue
              }

              const schedule = await lookupTrainSchedule(detected.trainNumber, eventDate)
              if (!schedule) continue

              // If we detected a boarding station from the event location/description,
              // use it as origin if it appears in the route (so e.g. boarding at STP
              // on the Empire Builder shows STP→SEA not CHI→SEA).
              let origin = schedule.origin
              let originName = schedule.originName ?? null
              let departureScheduled = schedule.departureScheduled

              if (detected.boardingStation && detected.boardingStation !== schedule.origin) {
                const boardingStop = schedule.stops.find(
                  s => s.code.toUpperCase() === detected.boardingStation!.toUpperCase()
                )
                if (boardingStop) {
                  origin = boardingStop.code
                  originName = boardingStop.name
                  // Use the boarding stop's scheduled departure time
                  if (boardingStop.scheduledDep) {
                    const [h, m] = boardingStop.scheduledDep.split(':').map(Number)
                    const d = new Date(schedule.departureScheduled)
                    d.setHours(h, m, 0, 0)
                    departureScheduled = d
                  }
                  console.log(`[calendar] Train ${detected.trainNumber}: boarding at ${origin} (${originName}) not route origin ${schedule.origin}`)
                }
              }

              await prisma.train.create({
                data: {
                  userId,
                  calendarEventId: event.id ?? null,
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
              flightsAdded++
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
    await recordSyncResult(userId, flightsAdded, msg)
    return flightsAdded
  }

  await recordSyncResult(userId, flightsAdded, null)
  return flightsAdded
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
