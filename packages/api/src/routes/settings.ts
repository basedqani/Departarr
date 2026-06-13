import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { getSetting, setSetting, RECOGNIZED_KEYS, type SettingKey } from '../lib/settings.js'
import { authMiddleware, adminMiddleware } from '../middleware/auth.js'
import { getUsage, getBudget, getMonthKey } from '../lib/apiBudget.js'

/** Show the last 4 chars of a secret, masking the rest with asterisks. */
function maskSecret(value: string): string {
  if (value.length <= 4) return '****'
  return '*'.repeat(value.length - 4) + value.slice(-4)
}

const SECRET_KEYS: SettingKey[] = ['flightaware_api_key', 'google_client_secret']
const BOOL_KEYS: SettingKey[] = [] // keys where only presence matters (none currently)

export async function settingsRoutes(app: FastifyInstance): Promise<void> {
  const adminGuard = [authMiddleware, adminMiddleware]

  // GET /api/settings — admin only
  app.get('/settings', { preHandler: adminGuard }, async (_req, reply) => {
    const result: Record<string, string | boolean | null | object> = {}

    for (const key of RECOGNIZED_KEYS) {
      const value = await getSetting(key)
      if (value === null) {
        result[key] = BOOL_KEYS.includes(key) ? false : null
      } else if (SECRET_KEYS.includes(key)) {
        result[key] = maskSecret(value)
      } else {
        result[key] = value
      }
    }

    // Read-only AeroAPI usage summary
    const now = new Date()
    const [calls, budget] = await Promise.all([getUsage(now), getBudget()])
    result['aeroapi_usage'] = {
      month: getMonthKey(now).replace('_', '-'),
      calls,
      budget,
    }

    return reply.send(result)
  })

  // PUT /api/settings — admin only
  const putSchema = z.object({
    key: z.enum(RECOGNIZED_KEYS as unknown as [string, ...string[]]),
    value: z.string(),
  })

  app.put('/settings', { preHandler: adminGuard }, async (req, reply) => {
    const body = putSchema.safeParse(req.body)
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

    await setSetting(body.data.key as SettingKey, body.data.value)
    return reply.send({ ok: true })
  })
}
