import type { FastifyInstance } from 'fastify'
import { randomBytes } from 'crypto'
import { prisma } from '../lib/prisma.js'
import { authMiddleware } from '../middleware/auth.js'

function generateToken(): string {
  return randomBytes(6).toString('base64url')
}

export async function shareRoutes(app: FastifyInstance): Promise<void> {
  // POST /api/flights/:id/share — create share token (auth required)
  app.post('/flights/:id/share', { preHandler: authMiddleware }, async (req, reply) => {
    const userId = (req.user as { id: string }).id
    const { id } = req.params as { id: string }

    const flight = await prisma.flight.findFirst({ where: { id, userId } })
    if (!flight) return reply.code(404).send({ error: 'Flight not found' })

    const token = generateToken()
    const shareToken = await prisma.shareToken.create({
      data: { flightId: id, token },
    })

    const url = `${process.env.APP_URL ?? ''}/share/${shareToken.token}`
    return reply.code(201).send({ token: shareToken.token, url })
  })

  // DELETE /api/flights/:id/share — revoke all share tokens (auth required)
  app.delete('/flights/:id/share', { preHandler: authMiddleware }, async (req, reply) => {
    const userId = (req.user as { id: string }).id
    const { id } = req.params as { id: string }

    const flight = await prisma.flight.findFirst({ where: { id, userId } })
    if (!flight) return reply.code(404).send({ error: 'Flight not found' })

    await prisma.shareToken.updateMany({
      where: { flightId: id, revokedAt: null },
      data: { revokedAt: new Date() },
    })
    return reply.code(204).send()
  })

  // POST /api/share/:token/push-subscribe — PUBLIC, no auth
  app.post('/share/:token/push-subscribe', async (req, reply) => {
    const { token } = req.params as { token: string }
    const body = req.body as { endpoint?: string; keys?: { p256dh?: string; auth?: string } }

    if (!body?.endpoint || !body?.keys?.p256dh || !body?.keys?.auth) {
      return reply.code(400).send({ error: 'Missing endpoint or keys' })
    }

    const shareToken = await prisma.shareToken.findUnique({ where: { token } })
    if (!shareToken || shareToken.revokedAt) {
      return reply.code(404).send({ error: 'Share token not found or revoked' })
    }

    await prisma.sharePushSubscription.upsert({
      where: { endpoint: body.endpoint },
      create: {
        shareTokenId: shareToken.id,
        endpoint: body.endpoint,
        p256dh: body.keys.p256dh,
        auth: body.keys.auth,
      },
      update: {
        shareTokenId: shareToken.id,
        p256dh: body.keys.p256dh,
        auth: body.keys.auth,
      },
    })
    return reply.code(201).send({ ok: true })
  })

  // DELETE /api/share/:token/push-subscribe — PUBLIC, no auth
  app.delete('/share/:token/push-subscribe', async (req, reply) => {
    const { token } = req.params as { token: string }
    const body = req.body as { endpoint?: string }
    if (!body?.endpoint) return reply.code(400).send({ error: 'Missing endpoint' })

    const shareToken = await prisma.shareToken.findUnique({ where: { token } })
    if (!shareToken) return reply.code(404).send({ error: 'Share token not found' })

    await prisma.sharePushSubscription.deleteMany({
      where: { endpoint: body.endpoint, shareTokenId: shareToken.id },
    })
    return reply.code(204).send()
  })

  // GET /api/share/:token — PUBLIC, no auth
  app.get('/share/:token', async (req, reply) => {
    const { token } = req.params as { token: string }

    const shareToken = await prisma.shareToken.findUnique({
      where: { token },
      include: {
        flight: {
          include: {
            events: { orderBy: { occurredAt: 'desc' }, take: 20 },
          },
        },
        trip: {
          include: {
            flights: { orderBy: { departureScheduled: 'asc' } },
          },
        },
      },
    })

    if (!shareToken || shareToken.revokedAt) {
      return reply.code(404).send({ error: 'Share link not found or revoked' })
    }

    return reply.send({
      flight: shareToken.flight,
      trip: shareToken.trip,
    })
  })
}
