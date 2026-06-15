import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { authMiddleware } from '../middleware/auth.js'
import { lookupFlight, lookupAllFlightLegs } from '../services/flightAware.js'
import { getAircraftPosition } from '../services/openSky.js'
import { analyseConnections } from '../services/connectionAssistant.js'
import { AIRPORT_COORDS } from '../data/airports.js'

const addFlightSchema = z.object({
  ident: z.string().min(2).max(10).toUpperCase(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  tripId: z.string().optional(),
  origin: z.string().length(3).toUpperCase().optional(),
  dest: z.string().length(3).toUpperCase().optional(),
})

const patchFlightSchema = z.object({
  seat: z.string().optional(),
  confirmationCode: z.string().optional(),
  tripId: z.string().nullable().optional(),
})

const lookupQuerySchema = z.object({
  ident: z.string().min(2).max(10),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
})

// In-memory photo cache: registration -> { data, expires }
interface PhotoCacheEntry {
  data: { url: string; link: string; photographer: string } | null
  expires: number
}
const photoCache = new Map<string, PhotoCacheEntry>()
const PHOTO_TTL_MS = 24 * 60 * 60 * 1000 // 24 hours

export async function flightRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware)

  // GET /api/flights
  app.get('/flights', async (req, reply) => {
    const userId = (req.user as { id: string }).id
    const { when } = req.query as { when?: string }
    const now = new Date()

    let where: Record<string, unknown> = { userId }

    if (when === 'today') {
      const startOfDay = new Date(now)
      startOfDay.setHours(0, 0, 0, 0)
      const endOfDay = new Date(now)
      endOfDay.setHours(23, 59, 59, 999)
      // Include flights that depart today OR flights that are still en route
      // (departed in the past but haven't landed/arrived/cancelled yet)
      where = {
        ...where,
        OR: [
          { departureScheduled: { gte: startOfDay, lte: endOfDay } },
          {
            departureScheduled: { lt: startOfDay },
            status: { notIn: ['landed', 'arrived', 'cancelled', 'Landed', 'Arrived', 'Cancelled'] },
          },
        ],
      }
    } else if (when === 'upcoming') {
      where = { ...where, departureScheduled: { gt: now } }
    } else if (when === 'past') {
      where = { ...where, departureScheduled: { lt: now } }
    }

    const flights = await prisma.flight.findMany({
      where,
      orderBy: { departureScheduled: when === 'upcoming' ? 'asc' : 'desc' },
      include: { trip: { select: { id: true, name: true } } },
    })
    return reply.send(flights)
  })

  // GET /api/flights/connections — analyse connection risk for upcoming flights
  app.get('/flights/connections', async (req, reply) => {
    const userId = (req.user as { id: string }).id
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)

    const flights = await prisma.flight.findMany({
      where: {
        userId,
        departureScheduled: { gte: twoDaysAgo },
      },
      orderBy: { departureScheduled: 'asc' },
    })

    const results = analyseConnections(flights)
    return reply.send(results)
  })

  // GET /api/flights/lookup — preview a flight WITHOUT saving it, so the user
  // can confirm before adding. (Static path is matched before /flights/:id.)
  app.get('/flights/lookup', async (req, reply) => {
    const q = lookupQuerySchema.safeParse(req.query)
    if (!q.success) return reply.code(400).send({ error: q.error.flatten() })

    const data = await lookupFlight(q.data.ident.toUpperCase().replace(/\s+/g, ''), q.data.date)
    if (!data) return reply.code(404).send({ error: 'Flight not found' })
    return reply.send(data)
  })

  // GET /api/flights/lookup-all — returns ALL legs for a flight number + date
  // so the UI can show a leg picker when a flight number covers multiple routes.
  app.get('/flights/lookup-all', async (req, reply) => {
    const q = lookupQuerySchema.safeParse(req.query)
    if (!q.success) return reply.code(400).send({ error: q.error.flatten() })

    const legs = await lookupAllFlightLegs(q.data.ident.toUpperCase().replace(/\s+/g, ''), q.data.date)
    if (legs.length === 0) return reply.code(404).send({ error: 'Flight not found' })
    return reply.send(legs)
  })

  // POST /api/flights
  app.post('/flights', async (req, reply) => {
    const userId = (req.user as { id: string }).id
    const body = addFlightSchema.safeParse(req.body)
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

    const flightData = await lookupFlight(body.data.ident, body.data.date, {
      origin: body.data.origin,
      dest: body.data.dest,
    })
    if (!flightData) return reply.code(404).send({ error: 'Flight not found' })

    const flight = await prisma.flight.create({
      data: {
        userId,
        tripId: body.data.tripId ?? null,
        ident: body.data.ident,
        faFlightId: flightData.faFlightId ?? null,
        airlineIata: flightData.airlineIata ?? null,
        flightNumber: flightData.flightNumber ?? null,
        origin: flightData.origin,
        destination: flightData.destination,
        departureScheduled: flightData.departureScheduled,
        departureEstimated: flightData.departureEstimated ?? null,
        departureActual: flightData.departureActual ?? null,
        arrivalScheduled: flightData.arrivalScheduled,
        arrivalEstimated: flightData.arrivalEstimated ?? null,
        arrivalActual: flightData.arrivalActual ?? null,
        takeoffScheduled: flightData.takeoffScheduled ?? null,
        takeoffEstimated: flightData.takeoffEstimated ?? null,
        takeoffActual: flightData.takeoffActual ?? null,
        landingScheduled: flightData.landingScheduled ?? null,
        landingEstimated: flightData.landingEstimated ?? null,
        landingActual: flightData.landingActual ?? null,
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
    return reply.code(201).send(flight)
  })

  // DELETE /api/flights/past — remove all past flights for the current user
  app.delete('/flights/past', async (req, reply) => {
    const userId = (req.user as { id: string }).id
    const now = new Date()
    const result = await prisma.flight.deleteMany({
      where: { userId, departureScheduled: { lt: now } },
    })
    return reply.send({ deleted: result.count })
  })

  // GET /api/flights/:id
  app.get('/flights/:id', async (req, reply) => {
    const userId = (req.user as { id: string }).id
    const { id } = req.params as { id: string }

    const flight = await prisma.flight.findFirst({
      where: { id, userId },
      include: {
        events: { orderBy: { occurredAt: 'desc' } },
        trip: { select: { id: true, name: true } },
      },
    })
    if (!flight) return reply.code(404).send({ error: 'Flight not found' })
    return reply.send(flight)
  })

  // DELETE /api/flights/:id
  app.delete('/flights/:id', async (req, reply) => {
    const userId = (req.user as { id: string }).id
    const { id } = req.params as { id: string }

    const flight = await prisma.flight.findFirst({ where: { id, userId } })
    if (!flight) return reply.code(404).send({ error: 'Flight not found' })

    await prisma.flight.delete({ where: { id } })
    return reply.code(204).send()
  })

  // GET /api/flights/:id/position
  app.get('/flights/:id/position', async (req, reply) => {
    const userId = (req.user as { id: string }).id
    const { id } = req.params as { id: string }

    const flight = await prisma.flight.findFirst({ where: { id, userId } })
    if (!flight) return reply.code(404).send({ error: 'Flight not found' })

    // Demo flights aren't real aircraft — skip the (heavy) OpenSky scan; the
    // client synthesises their position along the great-circle arc by time.
    if (flight.faFlightId?.startsWith('STUB-')) {
      return reply.code(404).send({ error: 'Position not available' })
    }

    const position = await getAircraftPosition({ ident: flight.ident, registration: flight.registration })
    if (!position) return reply.code(404).send({ error: 'Position not available' })

    return reply.send(position)
  })

  // PATCH /api/flights/:id — update user-editable fields
  app.patch('/flights/:id', async (req, reply) => {
    const userId = (req.user as { id: string }).id
    const { id } = req.params as { id: string }

    const body = patchFlightSchema.safeParse(req.body)
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

    const flight = await prisma.flight.findFirst({ where: { id, userId } })
    if (!flight) return reply.code(404).send({ error: 'Flight not found' })

    const updated = await prisma.flight.update({
      where: { id },
      data: {
        ...(body.data.seat !== undefined && { seat: body.data.seat }),
        ...(body.data.confirmationCode !== undefined && { confirmationCode: body.data.confirmationCode }),
        ...(body.data.tripId !== undefined && { tripId: body.data.tripId }),
      },
    })
    return reply.send(updated)
  })

  // GET /api/flights/:id/weather — Open-Meteo forecast at arrival time
  // Query params: ?units=imperial (default) or ?units=metric
  app.get('/flights/:id/weather', async (req, reply) => {
    const userId = (req.user as { id: string }).id
    const { id } = req.params as { id: string }
    const { units } = req.query as { units?: string }
    const useImperial = units !== 'metric' // default to imperial (Fahrenheit)

    const flight = await prisma.flight.findFirst({ where: { id, userId } })
    if (!flight) return reply.code(404).send({ error: 'Flight not found' })

    const coords = AIRPORT_COORDS[flight.destination.toUpperCase()]
    if (!coords) return reply.code(404).send({ error: 'Airport not in database' })

    const arrivalTime = flight.arrivalActual ?? flight.arrivalEstimated ?? flight.arrivalScheduled
    if (!arrivalTime) return reply.code(404).send({ error: 'No arrival time available' })

    const [lat, lon] = coords

    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 8000)
      const tempUnitParam = useImperial ? '&temperature_unit=fahrenheit' : ''
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=temperature_2m,weathercode,windspeed_10m,precipitation&timezone=auto&forecast_days=3${tempUnitParam}`
      const res = await fetch(url, { signal: controller.signal })
      clearTimeout(timer)

      if (!res.ok) return reply.code(502).send({ error: 'Weather service unavailable' })

      const json = await res.json() as {
        hourly: {
          time: string[]
          temperature_2m: number[]
          weathercode: number[]
          windspeed_10m: number[]
          precipitation: number[]
        }
      }

      const arrMs = new Date(arrivalTime).getTime()

      // Find the single closest slot to arrival time
      const closest = json.hourly.time
        .map((t, i) => ({
          time: t,
          temp: json.hourly.temperature_2m[i],
          code: json.hourly.weathercode[i],
          wind: json.hourly.windspeed_10m[i],
          precip: json.hourly.precipitation[i],
          diffMs: Math.abs(new Date(t).getTime() - arrMs),
        }))
        .sort((a, b) => a.diffMs - b.diffMs)[0]

      const slots = closest
        ? [{ time: closest.time, temp: closest.temp, code: closest.code, wind: closest.wind, precip: closest.precip }]
        : []

      return reply.send({ airport: flight.destination, arrivalTime, weather: slots })
    } catch {
      return reply.code(502).send({ error: 'Weather service unavailable' })
    }
  })

  // GET /api/flights/:id/photo — planespotters aircraft photo proxy
  app.get('/flights/:id/photo', async (req, reply) => {
    const userId = (req.user as { id: string }).id
    const { id } = req.params as { id: string }

    const flight = await prisma.flight.findFirst({ where: { id, userId } })
    if (!flight) return reply.code(404).send({ error: 'Flight not found' })

    if (!flight.registration) {
      return reply.code(204).send()
    }

    const reg = flight.registration
    const now = Date.now()

    // Check cache
    const cached = photoCache.get(reg)
    if (cached && cached.expires > now) {
      if (cached.data === null) return reply.code(204).send()
      return reply.send(cached.data)
    }

    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 5000)
      const url = `https://api.planespotters.net/pub/photos/reg/${encodeURIComponent(reg)}`
      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Departarr/1.0 (+https://github.com/departarr/departarr)',
        },
      })
      clearTimeout(timer)

      if (!res.ok) {
        photoCache.set(reg, { data: null, expires: now + PHOTO_TTL_MS })
        return reply.code(204).send()
      }

      const json = await res.json() as { photos?: Array<{
        id: string
        thumbnail: { src: string; size: { width: number; height: number } }
        thumbnail_large?: { src: string; size: { width: number; height: number } }
        link: string
        photographer: string
      }> }

      const photos = json.photos ?? []
      if (photos.length === 0) {
        photoCache.set(reg, { data: null, expires: now + PHOTO_TTL_MS })
        return reply.code(204).send()
      }

      const photo = photos[0]
      const data = {
        url: photo.thumbnail_large?.src ?? photo.thumbnail.src,
        link: photo.link,
        photographer: photo.photographer,
      }
      photoCache.set(reg, { data, expires: now + PHOTO_TTL_MS })
      return reply.send(data)
    } catch {
      // Network error or timeout — return null gracefully, do not cache
      return reply.code(204).send()
    }
  })
}
