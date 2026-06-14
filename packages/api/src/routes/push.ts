import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { getConfig } from '../lib/config.js'
import { authMiddleware } from '../middleware/auth.js'
import { sendPushToUser, sendPushToShareSubscribers } from '../services/webPush.js'

const subscribeSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string(),
    auth: z.string(),
  }),
})

export async function pushRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/push/vapid-public-key — no auth
  app.get('/vapid-public-key', async (_req, reply) => {
    return reply.send({ publicKey: getConfig().vapidPublicKey })
  })

  // POST /api/push/subscribe
  app.post('/subscribe', { preHandler: authMiddleware }, async (req, reply) => {
    const userId = (req.user as { id: string }).id
    const body = subscribeSchema.safeParse(req.body)
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

    const sub = await prisma.pushSubscription.upsert({
      where: { endpoint: body.data.endpoint },
      update: { p256dh: body.data.keys.p256dh, auth: body.data.keys.auth },
      create: {
        userId,
        endpoint: body.data.endpoint,
        p256dh: body.data.keys.p256dh,
        auth: body.data.keys.auth,
      },
    })
    return reply.code(201).send(sub)
  })

  // POST /api/push/test
  app.post('/test', { preHandler: authMiddleware }, async (req, reply) => {
    const userId = (req.user as { id: string }).id
    await sendPushToUser(userId, { title: 'Departarr · Test', message: 'Push notifications are working ✓', eventType: 'test' })
    return reply.send({ ok: true })
  })

  // DELETE /api/push/subscribe
  app.delete('/subscribe', { preHandler: authMiddleware }, async (req, reply) => {
    const { endpoint } = req.body as { endpoint: string }
    if (!endpoint) return reply.code(400).send({ error: 'Missing endpoint' })

    await prisma.pushSubscription.deleteMany({ where: { endpoint } })
    return reply.code(204).send()
  })

  // POST /api/push/simulate/:flightId — fire the full flight lifecycle as push
  // notifications so you can test background delivery with the app closed.
  // Sends: boarding → gate → departed → en-route → landed → baggage claim
  app.post('/simulate/:flightId', { preHandler: authMiddleware }, async (req, reply) => {
    const userId = (req.user as { id: string }).id
    const { flightId } = req.params as { flightId: string }

    const flight = await prisma.flight.findFirst({ where: { id: flightId, userId } })
    if (!flight) return reply.code(404).send({ error: 'Flight not found' })

    const ident = flight.ident
    const origin = flight.origin
    const dest = flight.destination

    const steps: Array<{ delayMs: number; eventType: string; title: string; message: string }> = [
      {
        delayMs: 0,
        eventType: 'status_change',
        title: `${ident} · Now Boarding`,
        message: `Gate B12 · ${origin} → ${dest}`,
      },
      {
        delayMs: 5_000,
        eventType: 'gate_change',
        title: `${ident} · Gate Change`,
        message: `Gate B12 → C7`,
      },
      {
        delayMs: 10_000,
        eventType: 'departure',
        title: `${ident} · Departed`,
        message: `Pushed back from ${origin}`,
      },
      {
        delayMs: 15_000,
        eventType: 'status_change',
        title: `${ident} · En Route`,
        message: `Cruising to ${dest}`,
      },
      {
        delayMs: 20_000,
        eventType: 'arrival',
        title: `${ident} · Landed`,
        message: `Arrived at ${dest}`,
      },
      {
        delayMs: 25_000,
        eventType: 'baggage',
        title: `${ident} · Baggage`,
        message: `Carousel 4`,
      },
    ]

    // Fire in background — don't block the response
    ;(async () => {
      for (const step of steps) {
        await new Promise<void>(resolve => setTimeout(resolve, step.delayMs))
        const payload = {
          type: 'flight_update',
          flightId: flight.id,
          ident,
          eventType: step.eventType,
          title: step.title,
          message: step.message,
        }
        await sendPushToUser(userId, payload)
        await sendPushToShareSubscribers(flightId, payload)
      }
    })().catch(console.error)

    return reply.send({ ok: true, steps: steps.length, totalMs: 25_000 })
  })
}
