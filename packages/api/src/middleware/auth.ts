import type { FastifyRequest, FastifyReply } from 'fastify'
import { prisma } from '../lib/prisma.js'

export async function authMiddleware(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  try {
    await req.jwtVerify()
  } catch {
    reply.code(401).send({ error: 'Unauthorized' })
  }
}

/**
 * Must run after authMiddleware. Rejects with 403 if the authenticated user is
 * not an admin. Always re-queries the DB so a downgraded admin is denied
 * immediately without needing to re-issue a JWT.
 */
export async function adminMiddleware(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const payload = req.user as { id: string }
  const user = await prisma.user.findUnique({ where: { id: payload.id }, select: { isAdmin: true } })
  if (!user?.isAdmin) {
    reply.code(403).send({ error: 'Forbidden' })
  }
}
