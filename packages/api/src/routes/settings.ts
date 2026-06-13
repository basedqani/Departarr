import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { getSetting, setSetting, getSettingWithEnvFallback, RECOGNIZED_KEYS, type SettingKey } from '../lib/settings.js'
import { authMiddleware, adminMiddleware } from '../middleware/auth.js'
import { getUsage, getBudget, getMonthKey } from '../lib/apiBudget.js'

/** Show the last 4 chars of a secret, masking the rest with asterisks. */
function maskSecret(value: string): string {
  if (value.length <= 4) return '****'
  return '*'.repeat(value.length - 4) + value.slice(-4)
}

const SECRET_KEYS: SettingKey[] = ['flightaware_api_key', 'aerodatabox_api_key', 'google_client_secret']
const BOOL_KEYS: SettingKey[] = [] // keys where only presence matters (none currently)

export async function settingsRoutes(app: FastifyInstance): Promise<void> {
  const adminGuard = [authMiddleware, adminMiddleware]

  // GET /api/features — PUBLIC: which integrations are configured (no secrets).
  // Lets the UI hide/disable integrations that the admin hasn't set up, so
  // users never get bounced to a broken third-party error page.
  app.get('/features', async (_req, reply) => {
    const [googleId, googleSecret, faKey, adbKey] = await Promise.all([
      getSettingWithEnvFallback('google_client_id', 'GOOGLE_CLIENT_ID'),
      getSettingWithEnvFallback('google_client_secret', 'GOOGLE_CLIENT_SECRET'),
      getSettingWithEnvFallback('flightaware_api_key', 'FLIGHTAWARE_API_KEY'),
      getSettingWithEnvFallback('aerodatabox_api_key', 'AERODATABOX_API_KEY'),
    ])
    const provider = faKey ? 'FlightAware' : adbKey ? 'AeroDataBox' : 'Demo'
    return reply.send({
      googleCalendar: Boolean(googleId && googleSecret),
      flightAware: Boolean(faKey),
      aeroDataBox: Boolean(adbKey),
      liveData: Boolean(faKey || adbKey),
      provider,
    })
  })

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

    // Read-only usage summary for whichever real provider is active
    const now = new Date()
    const faKey = await getSettingWithEnvFallback('flightaware_api_key', 'FLIGHTAWARE_API_KEY')
    const activeProvider = faKey ? 'aeroapi' : 'aerodatabox'
    const [calls, budget] = await Promise.all([getUsage(activeProvider, now), getBudget(activeProvider)])
    result['aeroapi_usage'] = {
      month: getMonthKey(now).replace('_', '-'),
      provider: faKey ? 'FlightAware' : 'AeroDataBox',
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
