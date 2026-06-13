import { prisma } from '../lib/prisma.js'
import { syncCalendarForUser } from './googleCalendar.js'

// Run every 6 hours, with a first run shortly after boot.
const SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000
const BOOT_DELAY_MS = 30 * 1000

// Guard against overlapping runs (e.g. a long sync still going when the next
// interval fires).
let inProgress = false

async function runScheduledSync(): Promise<void> {
  if (inProgress) {
    console.log('[calendar-scheduler] Previous run still in progress — skipping this cycle')
    return
  }
  inProgress = true

  try {
    // Find every distinct user that has a Google calendar connection.
    const connections = await prisma.calendarConnection.findMany({
      where: { provider: 'google' },
      select: { userId: true },
    })

    const userIds = Array.from(new Set(connections.map((c) => c.userId)))
    if (userIds.length === 0) return

    console.log(`[calendar-scheduler] Syncing ${userIds.length} connected user(s)`)

    // Sequential, with a try/catch per user so one failure never stops the rest.
    for (const userId of userIds) {
      try {
        const count = await syncCalendarForUser(userId)
        console.log(`[calendar-scheduler] User ${userId}: ${count} new flight(s)`)
      } catch (err) {
        console.error(`[calendar-scheduler] Sync failed for user ${userId}:`, err)
      }
    }
  } catch (err) {
    console.error('[calendar-scheduler] Run failed:', err)
  } finally {
    inProgress = false
  }
}

export function startCalendarScheduler(): void {
  console.log('Starting calendar auto-sync scheduler (every 6h, first run shortly after boot)')
  // First run shortly after boot so startup isn't blocked.
  setTimeout(() => {
    runScheduledSync().catch(console.error)
  }, BOOT_DELAY_MS)

  setInterval(() => {
    runScheduledSync().catch(console.error)
  }, SYNC_INTERVAL_MS)
}
