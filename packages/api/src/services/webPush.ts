import webpush from 'web-push'
import { prisma } from '../lib/prisma.js'
import { getConfig } from '../lib/config.js'
import { getSettingWithEnvFallback } from '../lib/settings.js'
import { AIRPORT_TZ } from '../data/airports.js'

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

export async function sendPushToShareSubscribers(flightId: string, payload: object): Promise<void> {
  await ensureInitialized()
  if (!initialized) return

  const tokens = await prisma.shareToken.findMany({
    where: { flightId, revokedAt: null },
    include: { sharePushSubscriptions: true },
  })

  const subs = tokens.flatMap(t => t.sharePushSubscriptions)
  if (subs.length === 0) return

  const message = JSON.stringify(payload)
  await Promise.allSettled(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          message
        )
      } catch (err: unknown) {
        if (err && typeof err === 'object' && 'statusCode' in err && (err as { statusCode: number }).statusCode === 410) {
          await prisma.sharePushSubscription.deleteMany({ where: { endpoint: sub.endpoint } })
        }
      }
    })
  )
}

/** Format a UTC timestamp in the local time of an airport (12h, no seconds). */
function fmtLocalTime(utcValue: string, airportIata?: string | null): string {
  const tz = (airportIata && AIRPORT_TZ[airportIata]) ?? 'UTC'
  const d = new Date(utcValue)
  if (isNaN(d.getTime())) return utcValue
  const formatted = d.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: tz,
  })
  return tz === 'UTC' ? `${formatted} UTC` : formatted
}

export interface PushNotification {
  title: string
  body: string
}

/** Render "+Nm" (or "" if not a positive delay) given two ISO timestamps. */
function delayMinutes(oldValue?: string | null, newValue?: string | null): number | null {
  if (!oldValue || !newValue) return null
  const o = new Date(oldValue).getTime()
  const n = new Date(newValue).getTime()
  if (isNaN(o) || isNaN(n)) return null
  return Math.round((n - o) / 60_000)
}

/**
 * Build a terse, Flighty-style push notification for a flight event.
 *
 * Every branch returns a NON-EMPTY body. Event types are the explicit ones the
 * poller derives (no generic `status_change` push). Each title is
 * `${ident} · <State>` with the state spelled in plain words (never "/" or "_").
 *
 * @param eventType   — explicit event type (see poller diff logic)
 * @param ident       — flight identifier, e.g. "AA 2083"
 * @param oldValue    — previous value (gate, status, timestamp…)
 * @param newValue    — new value
 * @param originIata  — origin airport code (for departure timezone)
 * @param destIata    — destination airport code (for arrival timezone)
 */
export function buildPushNotification(
  eventType: string,
  ident: string,
  oldValue?: string | null,
  newValue?: string | null,
  originIata?: string | null,
  destIata?: string | null,
): PushNotification {
  const hasOld = oldValue != null && oldValue !== 'null' && oldValue !== ''
  const hasNew = newValue != null && newValue !== 'null' && newValue !== ''

  switch (eventType) {
    case 'gate_assigned': {
      const body = hasNew ? `Gate ${newValue}` : 'Gate assigned'
      return { title: `${ident} · Gate ${hasNew ? newValue : 'assigned'}`, body }
    }

    case 'gate_change': {
      if (hasOld && hasNew) {
        return { title: `${ident} · Gate change`, body: `Gate ${oldValue} → ${newValue}` }
      }
      // Falls back to an assignment when there's no prior gate.
      const body = hasNew ? `Gate ${newValue}` : 'Gate assigned'
      return { title: `${ident} · Gate ${hasNew ? newValue : 'assigned'}`, body }
    }

    case 'boarding':
      return { title: `${ident} · Now boarding`, body: 'Now boarding' }

    case 'departure': {
      const timeStr = hasNew ? fmtLocalTime(newValue!, originIata) : null
      const body = timeStr ? `Pushed back at ${timeStr}` : 'Pushed back from gate'
      return { title: `${ident} · Pushed back`, body }
    }

    case 'en_route':
    case 'takeoff': {
      const timeStr = hasNew ? fmtLocalTime(newValue!, originIata) : null
      // `oldValue` carries the arrival ETA (dest tz) when available.
      const etaStr = hasOld ? fmtLocalTime(oldValue!, destIata) : null
      let body: string
      if (timeStr && etaStr) body = `Airborne at ${timeStr} · arrives ${etaStr}`
      else if (timeStr) body = `Airborne at ${timeStr}`
      else if (etaStr) body = `Airborne · arrives ${etaStr}`
      else body = 'Airborne'
      return { title: `${ident} · En route`, body }
    }

    case 'arrival': {
      const timeStr = hasNew ? fmtLocalTime(newValue!, destIata) : null
      const body = timeStr ? `Landed at ${timeStr}` : 'Landed'
      return { title: `${ident} · Landed`, body }
    }

    case 'at_gate': {
      const timeStr = hasNew ? fmtLocalTime(newValue!, destIata) : null
      const body = timeStr ? `At the gate at ${timeStr}` : 'At the gate'
      return { title: `${ident} · At the gate`, body }
    }

    case 'baggage': {
      const body = hasNew ? `Bags at carousel ${newValue}` : 'Bags on the way to carousel'
      return { title: `${ident} · Bags at carousel ${hasNew ? newValue : 'soon'}`, body }
    }

    case 'delay':
    case 'delay_departure': {
      const newStr = hasNew ? fmtLocalTime(newValue!, originIata) : null
      const mins = delayMinutes(oldValue, newValue)
      const suffix = mins != null && mins > 0 ? `, +${mins}m` : ''
      const body = newStr ? `Now ${newStr}${suffix}` : 'Departure delayed'
      return { title: `${ident} · Delayed`, body }
    }

    case 'delay_arrival': {
      const newStr = hasNew ? fmtLocalTime(newValue!, destIata) : null
      const mins = delayMinutes(oldValue, newValue)
      const suffix = mins != null && mins > 0 ? `, +${mins}m` : ''
      const body = newStr ? `Now arriving ${newStr}${suffix}` : 'Arriving later'
      return { title: `${ident} · Arriving later`, body }
    }

    case 'cancellation':
      return { title: `${ident} · Cancelled`, body: 'Check airline app for rebooking.' }

    case 'diverted': {
      const body = hasNew ? `Now heading to ${newValue}` : 'Flight diverted'
      return { title: `${ident} · Diverted`, body }
    }

    default:
      return { title: `${ident} · Update`, body: eventType.replace(/_/g, ' ') }
  }
}

/** Legacy single-string helper — kept for any callers that haven't migrated. */
export function buildPushMessage(eventType: string, oldValue?: string | null, newValue?: string | null): string {
  const n = buildPushNotification(eventType, '', oldValue, newValue)
  return n.body || n.title
}
