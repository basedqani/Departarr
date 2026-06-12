import type { FastifyInstance } from 'fastify'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { authMiddleware } from '../middleware/auth.js'

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
      select: { id: true, email: true, name: true, createdAt: true },
    })
    if (!user) return reply.code(404).send({ error: 'User not found' })
    return reply.send(user)
  })

  // Google OAuth start
  app.get('/google', { preHandler: authMiddleware }, async (req, reply) => {
    const { getGoogleOAuthUrl } = await import('../services/googleCalendar.js')
    const url = getGoogleOAuthUrl()
    return reply.redirect(url)
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

    await exchangeCodeForTokens(userId, code)
    return reply.redirect(`${process.env.APP_URL ?? ''}/settings?calendar=connected`)
  })
}
