import { prisma } from './prisma.js'

const DEFAULT_BUDGET = 900

export function getMonthKey(date: Date): string {
  const y = date.getUTCFullYear()
  const m = String(date.getUTCMonth() + 1).padStart(2, '0')
  return `${y}_${m}`
}

/** Returns the current month's usage setting key, e.g. aeroapi_usage_2026_06 */
function usageSettingKey(date: Date): string {
  return `aeroapi_usage_${getMonthKey(date)}`
}

export async function getUsage(date: Date = new Date()): Promise<number> {
  const key = usageSettingKey(date)
  const row = await prisma.setting.findUnique({ where: { key } })
  if (!row) return 0
  const n = parseInt(row.value, 10)
  return isNaN(n) ? 0 : n
}

export async function incrementUsage(n = 1, date: Date = new Date()): Promise<void> {
  const key = usageSettingKey(date)
  // Read-modify-write — low contention (only the poller writes to this)
  const current = await getUsage(date)
  const next = current + n
  await prisma.setting.upsert({
    where: { key },
    create: { key, value: String(next) },
    update: { value: String(next) },
  })
}

export async function getBudget(): Promise<number> {
  const row = await prisma.setting.findUnique({ where: { key: 'aeroapi_monthly_budget' } })
  if (!row) return DEFAULT_BUDGET
  const n = parseInt(row.value, 10)
  return isNaN(n) ? DEFAULT_BUDGET : n
}

export async function isOverBudget(date: Date = new Date()): Promise<boolean> {
  const [usage, budget] = await Promise.all([getUsage(date), getBudget()])
  return usage >= budget
}
