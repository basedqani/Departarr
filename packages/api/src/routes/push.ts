import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { getConfig } from '../lib/config.js'
import { authMiddleware } from '../middleware/auth.js'
import { sendPushToUser } from '../services/webPush.js'

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
    await sendPushToUser(userId, { title: 'Departarr ✈️', message: 'Push notifications are working!', eventType: 'test' })
    return reply.send({ ok: true })
  })

  // DELETE /api/push/subscribe
  app.delete('/subscribe', { preHandler: authMiddleware }, async (req, reply) => {
    const { endpoint } = req.body as { endpoint: string }
    if (!endpoint) return reply.code(400).send({ error: 'Missing endpoint' })

    await prisma.pushSubscription.deleteMany({ where: { endpoint } })
    return reply.code(204).send()
  })
}
