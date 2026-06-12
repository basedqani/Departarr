import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { authMiddleware } from '../middleware/auth.js'
import { lookupFlight } from '../services/flightAware.js'
import { getAircraftPosition } from '../services/openSky.js'

const addFlightSchema = z.object({
  ident: z.string().min(2).max(10).toUpperCase(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  tripId: z.string().optional(),
})

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
      where = {
        ...where,
        departureScheduled: { gte: startOfDay, lte: endOfDay },
      }
    } else if (when === 'upcoming') {
      where = { ...where, departureScheduled: { gt: now } }
    } else if (when === 'past') {
      where = { ...where, departureScheduled: { lt: now } }
    }

    const flights = await prisma.flight.findMany({
      where,
      orderBy: { departureScheduled: 'asc' },
      include: { trip: { select: { id: true, name: true } } },
    })
    return reply.send(flights)
  })

  // POST /api/flights
  app.post('/flights', async (req, reply) => {
    const userId = (req.user as { id: string }).id
    const body = addFlightSchema.safeParse(req.body)
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

    const flightData = await lookupFlight(body.data.ident, body.data.date)
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

    if (!flight.registration) return reply.code(404).send({ error: 'No registration available' })

    const position = await getAircraftPosition(flight.registration)
    if (!position) return reply.code(404).send({ error: 'Position not available' })

    return reply.send(position)
  })
}
