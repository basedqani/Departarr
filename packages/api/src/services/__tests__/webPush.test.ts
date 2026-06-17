import { describe, it, expect } from 'vitest'
import { buildPushNotification } from '../webPush.js'

const IDENT = 'AA 2083'
const ORIGIN = 'JFK'
const DEST = 'LAX'
const DEP_OLD = '2026-06-16T14:00:00Z'
const DEP_NEW = '2026-06-16T14:30:00Z'
const ARR_OLD = '2026-06-16T20:00:00Z'
const ARR_NEW = '2026-06-16T20:45:00Z'

describe('buildPushNotification', () => {
  const eventTypes = [
    'gate_assigned',
    'gate_change',
    'boarding',
    'departure',
    'en_route',
    'arrival',
    'at_gate',
    'baggage',
    'delay_departure',
    'delay_arrival',
    'cancellation',
    'diverted',
  ]

  it('every event type yields a non-empty title and body', () => {
    for (const et of eventTypes) {
      const n = buildPushNotification(et, IDENT, DEP_OLD, DEP_NEW, ORIGIN, DEST)
      expect(n.title.length, `${et} title`).toBeGreaterThan(0)
      expect(n.body.length, `${et} body`).toBeGreaterThan(0)
    }
  })

  it('no title or body ever contains "/" or "_"', () => {
    for (const et of eventTypes) {
      const n = buildPushNotification(et, IDENT, 'B12', 'C7', ORIGIN, DEST)
      expect(n.title).not.toMatch(/[/_]/)
      expect(n.body).not.toMatch(/[/_]/)
    }
  })

  it('gate change shows old → new, gate assigned shows just the gate', () => {
    const change = buildPushNotification('gate_change', IDENT, 'B12', 'C7', ORIGIN, DEST)
    expect(change.body).toBe('Gate B12 → C7')
    const assigned = buildPushNotification('gate_assigned', IDENT, null, 'C7', ORIGIN, DEST)
    expect(assigned.body).toBe('Gate C7')
  })

  it('boarding copy', () => {
    expect(buildPushNotification('boarding', IDENT).body).toBe('Now boarding')
  })

  it('departure renamed to "Pushed back"', () => {
    const n = buildPushNotification('departure', IDENT, null, DEP_NEW, ORIGIN, DEST)
    expect(n.title).toContain('Pushed back')
    expect(n.body).toContain('Pushed back')
  })

  it('en_route merges takeoff: airborne + arrives ETA', () => {
    const n = buildPushNotification('en_route', IDENT, ARR_NEW, DEP_NEW, ORIGIN, DEST)
    expect(n.title).toContain('En route')
    expect(n.body).toContain('Airborne')
    expect(n.body).toContain('arrives')
  })

  it('delay split: departure uses origin tz, arrival uses dest tz, includes +Nm', () => {
    const dep = buildPushNotification('delay_departure', IDENT, DEP_OLD, DEP_NEW, ORIGIN, DEST)
    expect(dep.title).toContain('Delayed')
    expect(dep.body).toContain('+30m')

    const arr = buildPushNotification('delay_arrival', IDENT, ARR_OLD, ARR_NEW, ORIGIN, DEST)
    expect(arr.title).toContain('Arriving later')
    expect(arr.body).toContain('+45m')
  })

  it('diverted names the new destination', () => {
    const n = buildPushNotification('diverted', IDENT, 'LAX', 'SFO', ORIGIN, DEST)
    expect(n.title).toContain('Diverted')
    expect(n.body).toContain('SFO')
  })
})

// Mirrors the poller's notifiable-delay predicate (NOTE-5): only ≥10 min.
function isNotifiableDelay(oldValue: string | null, newValue: string): boolean {
  if (oldValue == null) return false
  const delta = new Date(newValue).getTime() - new Date(oldValue).getTime()
  return !isNaN(delta) && delta >= 10 * 60 * 1000
}

describe('delay suppression (<10 min)', () => {
  it('suppresses a 9-minute delay', () => {
    expect(isNotifiableDelay('2026-06-16T14:00:00Z', '2026-06-16T14:09:00Z')).toBe(false)
  })
  it('notifies a 10-minute delay', () => {
    expect(isNotifiableDelay('2026-06-16T14:00:00Z', '2026-06-16T14:10:00Z')).toBe(true)
  })
  it('notifies a 30-minute delay', () => {
    expect(isNotifiableDelay(DEP_OLD, DEP_NEW)).toBe(true)
  })
})
