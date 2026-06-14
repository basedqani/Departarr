import { google } from 'googleapis'
import { prisma } from '../lib/prisma.js'
import { getSettingWithEnvFallback } from '../lib/settings.js'
import { detectFlightsInEvent, extractEventDate } from './flightDetector.js'
import { lookupFlight } from './flightAware.js'
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
      refreshToken: tokens.refresh_token ?? tokens.refresh_token ?? '',
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

            // Skip if already tracked (dedup against existing flights).
            // Widen to ±2 days around the event date so UTC day-boundary shifts
            // (e.g. 9:21 pm ET → next UTC day) can't cause a miss.
            // Also constrain by route when origin/dest are known, so two legs of
            // the same flight number on the same day aren't collapsed.
            const dayStart = new Date(`${date}T00:00:00Z`).getTime()
            const existing = await prisma.flight.findFirst({
              where: {
                userId,
                ident: flight.ident,
                departureScheduled: {
                  gte: new Date(dayStart - 36 * 3600 * 1000),
                  lt: new Date(dayStart + 60 * 3600 * 1000),
                },
                ...(flight.origin && flight.dest
                  ? { origin: flight.origin, destination: flight.dest }
                  : {}),
              },
            })
            if (existing) continue

            try {
              const departureUtc =
                (start as { date?: string; dateTime?: string }).dateTime ?? undefined
              const flightData = await lookupFlight(flight.ident, date, {
                origin: flight.origin,
                dest: flight.dest,
                departureUtc,
              })
              if (!flightData) {
                // For past flights, create a stub record from calendar data so
                // deleted flights are restored on re-sync even when the data
                // provider can't look them up (e.g. AeroDataBox free-tier only
                // covers active/near-future flights).
                const depDate = new Date(date + 'T12:00:00Z')
                if (depDate < new Date()) {
                  await prisma.flight.create({
                    data: {
                      userId,
                      ident: flight.ident,
                      faFlightId: null,
                      airlineIata: flight.airlineCode ?? null,
                      flightNumber: flight.flightNumber ?? null,
                      origin: flight.origin ?? '',
                      destination: flight.dest ?? '',
                      departureScheduled: depDate,
                      arrivalScheduled: new Date(depDate.getTime() + 2 * 60 * 60 * 1000),
                      status: 'arrived',
                      lastPolledAt: null,
                    },
                  })
                  flightsAdded++
                }
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
                  lastPolledAt: new Date(),
                },
              })
              flightsAdded++
            } catch (err) {
              console.error(`Failed to add flight ${flight.ident} from calendar:`, err)
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
