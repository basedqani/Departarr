import type { FastifyRequest, FastifyReply } from 'fastify'

export async function authMiddleware(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  try {
    await req.jwtVerify()
  } catch {
    reply.code(401).send({ error: 'Unauthorized' })
  }
}
