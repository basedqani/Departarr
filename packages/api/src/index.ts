// Config MUST be initialized before any other local imports that touch Prisma or secrets.
import { initConfig, getConfig } from './lib/config.js'

const config = await initConfig()

import Fastify from 'fastify'
import cors from '@fastify/cors'
import jwt from '@fastify/jwt'
import websocket from '@fastify/websocket'
import staticFiles from '@fastify/static'
import { existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { spawnSync } from 'child_process'
import { prisma } from './lib/prisma.js'
import { bootstrapAdmin } from './lib/bootstrap.js'
import { authRoutes } from './routes/auth.js'
import { flightRoutes } from './routes/flights.js'
import { tripRoutes } from './routes/trips.js'
import { shareRoutes } from './routes/share.js'
import { pushRoutes } from './routes/push.js'
import { calendarRoutes } from './routes/calendar.js'
import { settingsRoutes } from './routes/settings.js'
import { startPoller } from './services/poller.js'
import { startCalendarScheduler } from './services/calendarScheduler.js'
import { wsClients } from './lib/wsClients.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

// In dev the server applies its own migrations so a fresh clone boots with no
// extra steps. The container does this in its CMD before node starts.
if (process.env.NODE_ENV !== 'production') {
  const result = spawnSync('npx', ['prisma', 'migrate', 'deploy'], {
    cwd: join(__dirname, '..'),
    env: process.env,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
  if (result.status !== 0) {
    console.error('prisma migrate deploy failed — continuing, but queries may fail')
  }
}

const app = Fastify({ logger: true })

await app.register(cors, {
  origin: process.env.APP_URL ?? true,
  credentials: true,
})

await app.register(jwt, {
  secret: config.jwtSecret,
})

await app.register(websocket)

// Serve built PWA in production
const webDistEnv = process.env.WEB_DIST
const webDistContainer = '/app/web'
const webDistRelative = join(__dirname, '../../../apps/web/dist')

const webDist = webDistEnv ?? (existsSync(webDistContainer) ? webDistContainer : webDistRelative)

if (existsSync(webDist)) {
  await app.register(staticFiles, {
    root: webDist,
    prefix: '/',
    decorateReply: false,
  })

  // SPA fallback: non-/api, non-/ws GET requests get index.html
  app.setNotFoundHandler((req, reply) => {
    if (
      req.method === 'GET' &&
      !req.url.startsWith('/api') &&
      !req.url.startsWith('/ws')
    ) {
      return reply.sendFile('index.html', webDist)
    }
    return reply.code(404).send({ error: 'Not found' })
  })
} else {
  app.log.info(`Web dist not found at ${webDist} — running API-only (dev mode)`)
}

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
await app.register(settingsRoutes, { prefix: '/api' })

app.get('/api/health', async () => ({ status: 'ok' }))

const port = parseInt(process.env.PORT ?? '8080', 10)

try {
  await bootstrapAdmin()
  await app.listen({ port, host: '0.0.0.0' })
  console.log(`API listening on port ${port}`)
  startPoller()
  startCalendarScheduler()
} catch (err) {
  app.log.error(err)
  await prisma.$disconnect()
  process.exit(1)
}
