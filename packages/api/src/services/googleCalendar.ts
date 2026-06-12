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

  // Auto-refresh tokens
  oauth2Client.on('tokens', async (tokens) => {
    await prisma.calendarConnection.update({
      where: { id: connection.id },
      data: {
        accessToken: tokens.access_token ?? connection.accessToken,
        expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : connection.expiresAt,
      },
    })
  })

  const calendar = google.calendar({ version: 'v3', auth: oauth2Client })

  // Fetch events from now to 6 months out
  const timeMin = new Date().toISOString()
  const timeMax = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString()

  let pageToken: string | undefined
  let flightsAdded = 0

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

        // Skip if already tracked
        const existing = await prisma.flight.findFirst({
          where: { userId, ident: flight.ident, departureScheduled: { gte: new Date(`${date}T00:00:00Z`), lt: new Date(`${date}T23:59:59Z`) } },
        })
        if (existing) continue

        try {
          const flightData = await lookupFlight(flight.ident, date)
          if (!flightData) continue

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
    }

    pageToken = res.data.nextPageToken ?? undefined
  } while (pageToken)

  return flightsAdded
}
