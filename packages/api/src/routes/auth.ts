import type { FastifyInstance } from 'fastify'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { authMiddleware } from '../middleware/auth.js'
import { getSetting, getSettingWithEnvFallback } from '../lib/settings.js'

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1),
})

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
})

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post('/register', async (req, reply) => {
    const body = registerSchema.safeParse(req.body)
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

    // Registration gate: only bypass for the very first user
    const userCount = await prisma.user.count()
    if (userCount > 0) {
      const allowReg = await getSetting('allow_registration')
      if (allowReg === 'false') {
        return reply.code(403).send({ error: 'Registration is disabled' })
      }
    }

    const existing = await prisma.user.findUnique({ where: { email: body.data.email } })
    if (existing) return reply.code(409).send({ error: 'Email already registered' })

    const passwordHash = await bcrypt.hash(body.data.password, 12)
    const user = await prisma.user.create({
      data: { email: body.data.email, passwordHash, name: body.data.name },
      select: { id: true, email: true, name: true, createdAt: true },
    })

    const token = app.jwt.sign({ id: user.id, email: user.email }, { expiresIn: '30d' })
    return reply.code(201).send({ token, user })
  })

  app.post('/login', async (req, reply) => {
    const body = loginSchema.safeParse(req.body)
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

    const user = await prisma.user.findUnique({ where: { email: body.data.email } })
    if (!user) return reply.code(401).send({ error: 'Invalid credentials' })

    const valid = await bcrypt.compare(body.data.password, user.passwordHash)
    if (!valid) return reply.code(401).send({ error: 'Invalid credentials' })

    const token = app.jwt.sign({ id: user.id, email: user.email }, { expiresIn: '30d' })
    return reply.send({
      token,
      user: { id: user.id, email: user.email, name: user.name, createdAt: user.createdAt },
    })
  })

  app.get('/me', { preHandler: authMiddleware }, async (req, reply) => {
    const payload = req.user as { id: string }
    const user = await prisma.user.findUnique({
      where: { id: payload.id },
      select: { id: true, email: true, name: true, isAdmin: true, createdAt: true },
    })
    if (!user) return reply.code(404).send({ error: 'User not found' })
    return reply.send(user)
  })

  // Google OAuth start — hit via browser navigation, so the JWT arrives as a
  // query param rather than an Authorization header. It is verified here and
  // passed through the OAuth state param so the callback can identify the user.
  app.get('/google', async (req, reply) => {
    const { token } = req.query as { token?: string }
    if (!token) return reply.code(401).send({ error: 'Missing token' })
    try {
      app.jwt.verify(token)
    } catch {
      return reply.code(401).send({ error: 'Invalid token' })
    }

    // Graceful degradation: if the admin hasn't configured Google OAuth, send
    // the user back to Settings with a friendly flag instead of bouncing them
    // to Google's "Access blocked: missing client_id" error page.
    const clientId = await getSettingWithEnvFallback('google_client_id', 'GOOGLE_CLIENT_ID')
    const clientSecret = await getSettingWithEnvFallback('google_client_secret', 'GOOGLE_CLIENT_SECRET')
    if (!clientId || !clientSecret) {
      const proto = (req.headers['x-forwarded-proto'] as string | undefined) ?? 'http'
      const host = req.headers.host ?? 'localhost'
      const appUrl = process.env.APP_URL ?? `${proto}://${host}`
      return reply.redirect(`${appUrl}/settings?calendar=not_configured`)
    }

    const { getGoogleOAuthUrl } = await import('../services/googleCalendar.js')
    return reply.redirect(await getGoogleOAuthUrl(token, req))
  })

  // Google OAuth callback
  app.get('/google/callback', async (req, reply) => {
    const { code } = req.query as { code?: string }
    if (!code) return reply.code(400).send({ error: 'Missing code' })

    const { exchangeCodeForTokens } = await import('../services/googleCalendar.js')
    // We need a user — grab from state or session; for scaffold, require token in query
    const tokenParam = (req.query as Record<string, string>).state
    let userId: string
    try {
      const decoded = app.jwt.verify<{ id: string }>(tokenParam)
      userId = decoded.id
    } catch {
      return reply.code(401).send({ error: 'Invalid state token' })
    }

    await exchangeCodeForTokens(userId, code, req)

    // Derive app URL from request host for redirect
    const proto = (req.headers['x-forwarded-proto'] as string | undefined) ?? 'http'
    const host = req.headers.host ?? 'localhost'
    const appUrl = process.env.APP_URL ?? `${proto}://${host}`
    return reply.redirect(`${appUrl}/settings?calendar=connected`)
  })
}
