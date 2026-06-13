import { prisma } from './prisma.js'

// Per-provider monthly free-tier defaults (calls/units per month). Kept a bit
// under each provider's real free ceiling so we never overage.
const DEFAULT_BUDGET: Record<string, number> = {
  aeroapi: 900,       // FlightAware: ~1000 free calls ($5 credit)
  aerodatabox: 500,   // AeroDataBox: 600 free units/month
}
const FALLBACK_BUDGET = 500

// Legacy/default provider so existing FlightAware call-sites keep working.
const DEFAULT_PROVIDER = 'aeroapi'

export function getMonthKey(date: Date): string {
  const y = date.getUTCFullYear()
  const m = String(date.getUTCMonth() + 1).padStart(2, '0')
  return `${y}_${m}`
}

function usageSettingKey(provider: string, date: Date): string {
  return `${provider}_usage_${getMonthKey(date)}`
}

function budgetSettingKey(provider: string): string {
  return `${provider}_monthly_budget`
}

export async function getUsage(provider: string = DEFAULT_PROVIDER, date: Date = new Date()): Promise<number> {
  const row = await prisma.setting.findUnique({ where: { key: usageSettingKey(provider, date) } })
  if (!row) return 0
  const n = parseInt(row.value, 10)
  return isNaN(n) ? 0 : n
}

export async function incrementUsage(provider: string = DEFAULT_PROVIDER, n = 1, date: Date = new Date()): Promise<void> {
  const key = usageSettingKey(provider, date)
  // Read-modify-write — low contention (only the poller writes to this)
  const current = await getUsage(provider, date)
  const next = current + n
  await prisma.setting.upsert({
    where: { key },
    create: { key, value: String(next) },
    update: { value: String(next) },
  })
}

export async function getBudget(provider: string = DEFAULT_PROVIDER): Promise<number> {
  const row = await prisma.setting.findUnique({ where: { key: budgetSettingKey(provider) } })
  const fallback = DEFAULT_BUDGET[provider] ?? FALLBACK_BUDGET
  if (!row) return fallback
  const n = parseInt(row.value, 10)
  return isNaN(n) ? fallback : n
}

export async function isOverBudget(provider: string = DEFAULT_PROVIDER, date: Date = new Date()): Promise<boolean> {
  const [usage, budget] = await Promise.all([getUsage(provider, date), getBudget(provider)])
  return usage >= budget
}
