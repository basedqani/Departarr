import Fastify from 'fastify'
import cors from '@fastify/cors'
import jwt from '@fastify/jwt'
import websocket from '@fastify/websocket'
import { prisma } from './lib/prisma.js'
import { authRoutes } from './routes/auth.js'
import { flightRoutes } from './routes/flights.js'
import { tripRoutes } from './routes/trips.js'
import { shareRoutes } from './routes/share.js'
import { pushRoutes } from './routes/push.js'
import { calendarRoutes } from './routes/calendar.js'
import { startPoller } from './services/poller.js'
import { wsClients } from './lib/wsClients.js'

const app = Fastify({ logger: true })

await app.register(cors, {
  origin: process.env.APP_URL ?? true,
  credentials: true,
})

await app.register(jwt, {
  secret: process.env.JWT_SECRET ?? 'change-me',
})

await app.register(websocket)

// WebSocket endpoint
app.get('/ws', { websocket: true }, (socket, req) => {
  let userId: string | null = null
  try {
    const token = (req.query as Record<string, string>).token
    if (token) {
      const decoded = app.jwt.verify<{ id: string }>(token)
      userId = decoded.id
      wsClients.add(userId, socket)
    }
  } catch {
    socket.close()
    return
  }

  socket.on('close', () => {
    if (userId) wsClients.remove(userId, socket)
  })
})

await app.register(authRoutes, { prefix: '/api/auth' })
await app.register(flightRoutes, { prefix: '/api' })
await app.register(tripRoutes, { prefix: '/api' })
await app.register(shareRoutes, { prefix: '/api' })
await app.register(pushRoutes, { prefix: '/api/push' })
await app.register(calendarRoutes, { prefix: '/api' })

app.get('/api/health', async () => ({ status: 'ok' }))

const port = parseInt(process.env.PORT ?? '3000', 10)

try {
  await app.listen({ port, host: '0.0.0.0' })
  console.log(`API listening on port ${port}`)
  startPoller()
} catch (err) {
  app.log.error(err)
  await prisma.$disconnect()
  process.exit(1)
}
