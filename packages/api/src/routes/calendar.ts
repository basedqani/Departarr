import type { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { authMiddleware } from '../middleware/auth.js'
import { syncCalendarForUser } from '../services/googleCalendar.js'

export async function calendarRoutes(app: FastifyInstance): Promise<void> {
  // POST /api/calendar/webhook — Google push notification receiver (no auth, validated by Google)
  app.post('/calendar/webhook', async (req, reply) => {
    const channelId = req.headers['x-goog-channel-id'] as string | undefined
    const resourceState = req.headers['x-goog-resource-state'] as string | undefined

    if (!channelId || resourceState === 'sync') {
      return reply.code(200).send()
    }

    // Find the connection with this channelId
    const connection = await prisma.calendarConnection.findFirst({
      where: { channelId },
    })
    if (!connection) return reply.code(200).send()

    // Trigger a sync in background, don't block the response
    syncCalendarForUser(connection.userId).catch(console.error)
    return reply.code(200).send()
  })

  // POST /api/calendar/sync — manual full sync
  app.post('/calendar/sync', { preHandler: authMiddleware }, async (req, reply) => {
    const userId = (req.user as { id: string }).id
    try {
      const count = await syncCalendarForUser(userId)
      return reply.send({ flightsFound: count })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      return reply.code(500).send({ error: msg })
    }
  })
}
