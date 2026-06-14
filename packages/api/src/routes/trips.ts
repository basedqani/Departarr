import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { authMiddleware } from '../middleware/auth.js'

const createTripSchema = z.object({
  name: z.string().min(1),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
})

const updateTripSchema = z.object({
  name: z.string().min(1).optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
})

export async function tripRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware)

  app.get('/trips', async (req, reply) => {
    const userId = (req.user as { id: string }).id
    const trips = await prisma.trip.findMany({
      where: { userId },
      orderBy: { startDate: 'asc' },
      include: {
        flights: {
          orderBy: { departureScheduled: 'asc' },
          select: {
            id: true, ident: true, origin: true, destination: true,
            departureScheduled: true, arrivalScheduled: true, status: true,
          },
        },
        trains: {
          orderBy: { departureScheduled: 'asc' },
          select: {
            id: true, trainNumber: true, trainName: true, origin: true, destination: true,
            departureScheduled: true, arrivalScheduled: true, status: true,
          },
        },
      },
    })
    return reply.send(trips)
  })

  app.post('/trips', async (req, reply) => {
    const userId = (req.user as { id: string }).id
    const body = createTripSchema.safeParse(req.body)
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

    const trip = await prisma.trip.create({
      data: {
        userId,
        name: body.data.name,
        startDate: body.data.startDate ? new Date(body.data.startDate) : null,
        endDate: body.data.endDate ? new Date(body.data.endDate) : null,
      },
    })
    return reply.code(201).send(trip)
  })

  app.get('/trips/:id', async (req, reply) => {
    const userId = (req.user as { id: string }).id
    const { id } = req.params as { id: string }

    const trip = await prisma.trip.findFirst({
      where: { id, userId },
      include: {
        flights: { orderBy: { departureScheduled: 'asc' } },
        trains: {
          orderBy: { departureScheduled: 'asc' },
          include: { events: { orderBy: { occurredAt: 'desc' } } },
        },
      },
    })
    if (!trip) return reply.code(404).send({ error: 'Trip not found' })
    return reply.send(trip)
  })

  app.put('/trips/:id', async (req, reply) => {
    const userId = (req.user as { id: string }).id
    const { id } = req.params as { id: string }
    const body = updateTripSchema.safeParse(req.body)
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

    const trip = await prisma.trip.findFirst({ where: { id, userId } })
    if (!trip) return reply.code(404).send({ error: 'Trip not found' })

    const updated = await prisma.trip.update({
      where: { id },
      data: {
        name: body.data.name,
        startDate: body.data.startDate ? new Date(body.data.startDate) : undefined,
        endDate: body.data.endDate ? new Date(body.data.endDate) : undefined,
      },
    })
    return reply.send(updated)
  })

  app.delete('/trips/:id', async (req, reply) => {
    const userId = (req.user as { id: string }).id
    const { id } = req.params as { id: string }

    const trip = await prisma.trip.findFirst({ where: { id, userId } })
    if (!trip) return reply.code(404).send({ error: 'Trip not found' })

    await prisma.trip.delete({ where: { id } })
    return reply.code(204).send()
  })

  // POST /api/trips/:id/flights — attach an existing flight
  app.post('/trips/:id/flights', async (req, reply) => {
    const userId = (req.user as { id: string }).id
    const { id } = req.params as { id: string }
    const { flightId } = req.body as { flightId: string }

    const trip = await prisma.trip.findFirst({ where: { id, userId } })
    if (!trip) return reply.code(404).send({ error: 'Trip not found' })

    const flight = await prisma.flight.findFirst({ where: { id: flightId, userId } })
    if (!flight) return reply.code(404).send({ error: 'Flight not found' })

    const updated = await prisma.flight.update({
      where: { id: flightId },
      data: { tripId: id },
    })
    return reply.send(updated)
  })

  // POST /api/trips/:id/trains — attach an existing train
  app.post('/trips/:id/trains', async (req, reply) => {
    const userId = (req.user as { id: string }).id
    const { id } = req.params as { id: string }
    const { trainId } = req.body as { trainId: string }

    const trip = await prisma.trip.findFirst({ where: { id, userId } })
    if (!trip) return reply.code(404).send({ error: 'Trip not found' })

    const train = await prisma.train.findFirst({ where: { id: trainId, userId } })
    if (!train) return reply.code(404).send({ error: 'Train not found' })

    const updated = await prisma.train.update({
      where: { id: trainId },
      data: { tripId: id },
    })
    return reply.send(updated)
  })
}
