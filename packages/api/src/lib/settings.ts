import { prisma } from './prisma.js'

export const RECOGNIZED_KEYS = [
  'flightaware_api_key',
  'aerodatabox_api_key',
  'google_client_id',
  'google_client_secret',
  'vapid_subject',
  'allow_registration',
  'aeroapi_monthly_budget',
  'aerodatabox_monthly_budget',
] as const

export type SettingKey = (typeof RECOGNIZED_KEYS)[number]

// Small in-memory cache
const cache = new Map<string, string>()

export async function getSetting(key: SettingKey): Promise<string | null> {
  if (cache.has(key)) return cache.get(key)!

  const row = await prisma.setting.findUnique({ where: { key } })
  if (row) {
    cache.set(key, row.value)
    return row.value
  }
  return null
}

export async function setSetting(key: SettingKey, value: string): Promise<void> {
  await prisma.setting.upsert({
    where: { key },
    create: { key, value },
    update: { value },
  })
  cache.set(key, value)
}

/** Return the setting value, falling back to an env var if not set in DB. */
export async function getSettingWithEnvFallback(
  key: SettingKey,
  envVar: string
): Promise<string | null> {
  const dbVal = await getSetting(key)
  if (dbVal) return dbVal
  return process.env[envVar] ?? null
}
