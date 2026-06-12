import webpush from 'web-push'
import { prisma } from '../lib/prisma.js'
import { getConfig } from '../lib/config.js'
import { getSettingWithEnvFallback } from '../lib/settings.js'

let initialized = false

async function ensureInitialized(): Promise<void> {
  if (initialized) return

  const cfg = getConfig()
  const publicKey = cfg.vapidPublicKey
  const privateKey = cfg.vapidPrivateKey
  const subject =
    (await getSettingWithEnvFallback('vapid_subject', 'VAPID_SUBJECT')) ??
    'mailto:admin@example.com'

  if (publicKey && privateKey) {
    webpush.setVapidDetails(subject, publicKey, privateKey)
    initialized = true
  }
}

export async function sendPushToUser(userId: string, payload: object): Promise<void> {
  await ensureInitialized()
  if (!initialized) return

  const subs = await prisma.pushSubscription.findMany({ where: { userId } })
  const message = JSON.stringify(payload)

  await Promise.allSettled(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          message
        )
      } catch (err: unknown) {
        // 410 Gone = subscription expired, clean up
        if (err && typeof err === 'object' && 'statusCode' in err && (err as { statusCode: number }).statusCode === 410) {
          await prisma.pushSubscription.deleteMany({ where: { endpoint: sub.endpoint } })
        }
      }
    })
  )
}

export function buildPushMessage(eventType: string, oldValue?: string | null, newValue?: string | null): string {
  switch (eventType) {
    case 'gate_change':
      return `Gate changed: ${oldValue ?? '?'} → ${newValue ?? '?'}`
    case 'delay':
      return `Flight delayed${newValue ? `: now ${newValue}` : ''}`
    case 'cancellation':
      return 'Flight cancelled'
    case 'departure':
      return `Flight departed${newValue ? ` at ${newValue}` : ''}`
    case 'arrival':
      return `Flight arrived${newValue ? ` at ${newValue}` : ''}`
    case 'baggage':
      return `Baggage claim: ${newValue ?? '?'}`
    case 'status_change':
      return `Status: ${oldValue ?? '?'} → ${newValue ?? '?'}`
    default:
      return `Update: ${eventType}`
  }
}
