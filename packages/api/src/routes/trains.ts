import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { authMiddleware } from '../middleware/auth.js'
import { lookupTrainSchedule } from '../services/gtfs.js'
import { fetchLiveTrainStatus } from '../services/amtraker.js'
import { getAmtrakStation } from '../data/amtrakStations.js'

const addTrainSchema = z.object({
  trainNumber: z.string().min(1).max(5),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  tripId: z.string().optional(),
  origin: z.string().optional(),
  destination: z.string().optional(),
  boardingStop: z.object({ code: z.string(), schDep: z.string().optional() }).optional(),
})

const patchTrainSchema = z.object({
  seat: z.string().optional(),
  confirmationCode: z.string().optional(),
  tripId: z.string().nullable().optional(),
})

const lookupQuerySchema = z.object({
  number: z.string().min(1).max(5),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
})

export async function trainRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware)

  // GET /api/trains
  app.get('/trains', async (req, reply) => {
    const userId = (req.user as { id: string }).id
    const { when, localDate, tzOffset } = req.query as { when?: string; localDate?: string; tzOffset?: string }
    const now = new Date()

    let where: Record<string, unknown> = { userId }

    const arrivedStatuses = ['landed', 'arrived', 'cancelled', 'Landed', 'Arrived', 'Cancelled']
    const airborneStatuses = ['departed', 'en_route', 'en-route', 'at-station', 'Departed', 'En-Route']

    // GEN-11: reject malformed tz params instead of silently emptying the view.
    if (localDate !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(localDate)) {
      return reply.code(400).send({ error: 'Invalid localDate' })
    }
    if (tzOffset !== undefined && Number.isNaN(parseInt(tzOffset, 10))) {
      return reply.code(400).send({ error: 'Invalid tzOffset' })
    }

    if (when === 'today') {
      let startOfDay: Date
      let endOfDay: Date
      if (localDate && tzOffset !== undefined) {
        const offsetMs = parseInt(tzOffset, 10) * 60 * 1000
        startOfDay = new Date(new Date(`${localDate}T00:00:00Z`).getTime() + offsetMs)
        endOfDay   = new Date(new Date(`${localDate}T23:59:59.999Z`).getTime() + offsetMs)
      } else {
        startOfDay = new Date(now)
        startOfDay.setHours(0, 0, 0, 0)
        endOfDay = new Date(now)
        endOfDay.setHours(23, 59, 59, 999)
      }
      // Same semantics as flights.ts: GEN-2 keeps an airborne leg on Today
      // regardless of departure day; R-1 keeps a leg that arrived earlier today
      // (confirmed terminal status) on Today until end of local day; stale
      // statuses never override a real arrival timestamp.
      const notYetArrived = [
        { arrivalActual: { gt: now } },
        { arrivalActual: null, arrivalEstimated: { gt: now } },
        { arrivalActual: null, arrivalEstimated: null, arrivalScheduled: { gt: now } },
        { arrivalActual: null, arrivalEstimated: null, arrivalScheduled: null, status: { notIn: arrivedStatuses } },
      ]
      where = {
        ...where,
        OR: [
          { AND: [{ status: { in: airborneStatuses } }, { OR: notYetArrived }] },
          { AND: [{ departureScheduled: { gte: startOfDay, lte: endOfDay } }, { OR: notYetArrived }] },
          {
            AND: [
              { departureScheduled: { gte: startOfDay, lte: endOfDay } },
              { status: { in: arrivedStatuses } },
              {
                OR: [
                  { arrivalActual: { gte: startOfDay, lte: endOfDay } },
                  { arrivalActual: null, arrivalEstimated: { gte: startOfDay, lte: endOfDay } },
                  { arrivalActual: null, arrivalEstimated: null, arrivalScheduled: { gte: startOfDay, lte: endOfDay } },
                  { arrivalActual: null, arrivalEstimated: null, arrivalScheduled: null },
                ],
              },
            ],
          },
        ],
      }
    } else if (when === 'upcoming') {
      where = { ...where, departureScheduled: { gt: now } }
    } else if (when === 'past') {
      // Past only once it has actually arrived — now is AFTER arrival time
      // (actual ?? estimated ?? scheduled) OR status is arrived. A passed
      // DEPARTURE time alone does NOT move it to Past.
      where = {
        ...where,
        OR: [
          { arrivalActual: { lte: now } },
          { arrivalActual: null, arrivalEstimated: { lte: now } },
          { arrivalActual: null, arrivalEstimated: null, arrivalScheduled: { lte: now } },
          { status: { in: arrivedStatuses } },
        ],
      }
    }

    const trains = await prisma.train.findMany({
      where,
      orderBy: { departureScheduled: when === 'upcoming' ? 'asc' : 'desc' },
      include: { trip: { select: { id: true, name: true } } },
    })
    return reply.send(trains)
  })

  // GET /api/trains/lookup
  app.get('/trains/lookup', async (req, reply) => {
    const q = lookupQuerySchema.safeParse(req.query)
    if (!q.success) return reply.code(400).send({ error: q.error.flatten() })

    const schedule = await lookupTrainSchedule(q.data.number, q.data.date)
    if (!schedule) return reply.code(404).send({ error: 'Train schedule not found for this date' })

    // Enrich with live data if today
    const today = new Date().toISOString().substring(0, 10)
    let live = null
    if (q.data.date === today) {
      live = await fetchLiveTrainStatus(q.data.number, schedule.origin).catch(() => null)
    }

    return reply.send({ ...schedule, live })
  })

  // POST /api/trains
  app.post('/trains', async (req, reply) => {
    const userId = (req.user as { id: string }).id
    const body = addTrainSchema.safeParse(req.body)
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

    const schedule = await lookupTrainSchedule(body.data.trainNumber, body.data.date)
    if (!schedule) return reply.code(404).send({ error: 'Train schedule not found for this date' })

    // If a specific boarding stop was picked, adjust origin and departure time.
    // Each schedule stop now carries an absolute ISO `schDep`/`schArr` already
    // computed in that stop's own timezone (see gtfs.ts computeStopInstantUtc),
    // so we simply read the boarding stop's instant — no hand-rolled overflow math.
    let origin = body.data.origin ?? schedule.origin
    let originName = schedule.originName ?? null
    let departureScheduled = schedule.departureScheduled
    let arrivalScheduled = schedule.arrivalScheduled
    let boardingStopCode = origin
    let alightingStopCode = body.data.destination ?? schedule.destination

    if (body.data.boardingStop) {
      const stopInfo = schedule.stops.find(s => s.code === body.data.boardingStop!.code)
      if (stopInfo) {
        origin = stopInfo.code
        originName = stopInfo.name
        boardingStopCode = stopInfo.code
        const inst = stopInfo.schDep ?? stopInfo.schArr
        if (inst) departureScheduled = new Date(inst)
      }
    }
    if (body.data.destination) {
      const alightInfo = schedule.stops.find(s => s.code === body.data.destination)
      if (alightInfo) {
        alightingStopCode = alightInfo.code
        const inst = alightInfo.schArr ?? alightInfo.schDep
        if (inst) arrivalScheduled = new Date(inst)
      }
    }

    // TR-4: prefer the live Amtraker consist's ISO scheduled times when available —
    // they sidestep GTFS overflow math entirely. Match on the boarding stop code.
    try {
      const live = await fetchLiveTrainStatus(schedule.trainNumber, schedule.origin)
      if (live) {
        const boardLive = live.stops.find(s => s.code.toUpperCase() === boardingStopCode.toUpperCase())
        if (boardLive?.schDep) departureScheduled = new Date(boardLive.schDep)
        const alightLive = live.stops.find(s => s.code.toUpperCase() === alightingStopCode.toUpperCase())
        if (alightLive?.schArr) arrivalScheduled = new Date(alightLive.schArr)
      }
    } catch { /* graceful fallback to GTFS */ }

    const train = await prisma.train.create({
      data: {
        userId,
        tripId: body.data.tripId ?? null,
        trainNumber: schedule.trainNumber,
        trainName: schedule.trainName ?? null,
        origin,
        destination: body.data.destination ?? schedule.destination,
        originName,
        destinationName: schedule.destinationName ?? null,
        departureScheduled,
        arrivalScheduled,
        stopsJson: schedule.stops.length > 0 ? JSON.stringify(schedule.stops) : null,
        status: 'scheduled',
        lastPolledAt: null,
      },
    })
    return reply.code(201).send(train)
  })

  // GET /api/trains/:id
  app.get('/trains/:id', async (req, reply) => {
    const userId = (req.user as { id: string }).id
    const { id } = req.params as { id: string }

    const train = await prisma.train.findFirst({
      where: { id, userId },
      include: {
        events: { orderBy: { occurredAt: 'desc' } },
        trip: { select: { id: true, name: true } },
      },
    })
    if (!train) return reply.code(404).send({ error: 'Train not found' })
    return reply.send(train)
  })

  // PATCH /api/trains/:id
  app.patch('/trains/:id', async (req, reply) => {
    const userId = (req.user as { id: string }).id
    const { id } = req.params as { id: string }

    const body = patchTrainSchema.safeParse(req.body)
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

    const train = await prisma.train.findFirst({ where: { id, userId } })
    if (!train) return reply.code(404).send({ error: 'Train not found' })

    const updated = await prisma.train.update({
      where: { id },
      data: {
        ...(body.data.seat !== undefined && { seat: body.data.seat }),
        ...(body.data.confirmationCode !== undefined && { confirmationCode: body.data.confirmationCode }),
        ...(body.data.tripId !== undefined && { tripId: body.data.tripId }),
      },
    })
    return reply.send(updated)
  })

  // DELETE /api/trains/:id
  app.delete('/trains/:id', async (req, reply) => {
    const userId = (req.user as { id: string }).id
    const { id } = req.params as { id: string }

    const train = await prisma.train.findFirst({ where: { id, userId } })
    if (!train) return reply.code(404).send({ error: 'Train not found' })

    await prisma.train.delete({ where: { id } })
    return reply.code(204).send()
  })

  // GET /api/trains/:id/weather
  app.get('/trains/:id/weather', async (req, reply) => {
    const userId = (req.user as { id: string }).id
    const { id } = req.params as { id: string }
    const { units } = req.query as { units?: string }
    const useImperial = units !== 'metric'

    const train = await prisma.train.findFirst({ where: { id, userId } })
    if (!train) return reply.code(404).send({ error: 'Train not found' })

    const coords = getAmtrakStation(train.destination)
    if (!coords) return reply.code(404).send({ error: 'Station not in database' })

    const arrivalTime = train.arrivalActual ?? train.arrivalEstimated ?? train.arrivalScheduled
    if (!arrivalTime) return reply.code(404).send({ error: 'No arrival time available' })

    const { lat, lon } = coords

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

      return reply.send({ station: train.destination, arrivalTime, weather: slots })
    } catch {
      return reply.code(502).send({ error: 'Weather service unavailable' })
    }
  })
}
