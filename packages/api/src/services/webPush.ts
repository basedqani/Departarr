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

/** Friendly label for a status value coming from the data provider. */
function statusLabel(raw: string): string {
  switch (raw.toLowerCase()) {
    case 'scheduled':      return 'Scheduled'
    case 'boarding':       return 'Now Boarding'
    case 'departed':       return 'Departed'
    case 'en_route':
    case 'en-route':       return 'En Route'
    case 'landed':         return 'Landed'
    case 'arrived':        return 'Arrived'
    case 'cancelled':      return 'Cancelled'
    case 'diverted':       return 'Diverted'
    case 'delayed':        return 'Delayed'
    default:               return raw
  }
}

export interface PushNotification {
  title: string
  body: string
}

/**
 * Build a terse, Flighty-style push notification for a flight event.
 *
 * @param eventType   — one of the known event type strings
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
  switch (eventType) {
    case 'gate_change': {
      const hasOld = oldValue && oldValue !== 'null'
      const hasNew = newValue && newValue !== 'null'
      const gateDesc = hasOld && hasNew
        ? `Gate ${oldValue} → ${newValue}`
        : hasNew
          ? `Gate ${newValue}`
          : 'Gate updated'
      const shortStatus = hasOld && hasNew ? 'Gate Change' : 'Gate Assigned'
      return { title: `${ident} · ${shortStatus}`, body: gateDesc }
    }

    case 'delay': {
      // newValue is an ISO timestamp for the updated departure/arrival time
      const timeStr = newValue ? fmtLocalTime(newValue, originIata) : null
      const body = timeStr ? `Now departs ${timeStr}` : 'Departure time updated'
      return { title: `${ident} · Delayed`, body }
    }

    case 'cancellation':
      return {
        title: `${ident} · Cancelled`,
        body: 'Check airline app for rebooking.',
      }

    case 'departure': {
      const timeStr = newValue ? fmtLocalTime(newValue, originIata) : null
      const body = timeStr ? `Pushed back at ${timeStr}` : 'Pushed back from gate'
      return { title: `${ident} · Departed Gate`, body }
    }

    case 'takeoff': {
      const timeStr = newValue ? fmtLocalTime(newValue, originIata) : null
      const body = timeStr ? `Wheels up at ${timeStr}` : 'Airborne'
      return { title: `${ident} · Airborne`, body }
    }

    case 'arrival': {
      const timeStr = newValue ? fmtLocalTime(newValue, destIata) : null
      const body = timeStr ? `Landed at ${timeStr}` : 'Landed'
      return { title: `${ident} · Landed`, body }
    }

    case 'baggage': {
      const body = newValue ? `Carousel ${newValue}` : 'Baggage claim info updated'
      return { title: `${ident} · Baggage`, body }
    }

    case 'status_change': {
      const label = newValue ? statusLabel(newValue) : 'Status updated'
      return { title: `${ident} · ${label}`, body: '' }
    }

    default:
      return { title: `${ident} · Update`, body: eventType }
  }
}

/** Legacy single-string helper — kept for any callers that haven't migrated. */
export function buildPushMessage(eventType: string, oldValue?: string | null, newValue?: string | null): string {
  const n = buildPushNotification(eventType, '', oldValue, newValue)
  return n.body || n.title
}
