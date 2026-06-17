import { describe, it, expect } from 'vitest'
import { normalizeStatus } from '../flightStatus.js'

describe('normalizeStatus', () => {
  const cases: Array<[string, string, boolean]> = [
    // [raw, expected base, expected delayed]
    ['Scheduled', 'scheduled', false],
    ['Expected', 'scheduled', false],
    ['Boarding', 'boarding', false],
    ['CheckIn', 'boarding', false],
    ['Departed', 'departed', false],
    ['GateClosed', 'departed', false],
    ['EnRoute', 'en_route', false],
    ['En Route', 'en_route', false],
    ['Approaching', 'en_route', false],
    ['Taxiing', 'taxiing', false],
    ['Taxis', 'taxiing', false],
    ['Landed', 'arrived', false],
    ['Arrived', 'arrived', false],
    ['Cancelled', 'cancelled', false],
    ['Canceled', 'cancelled', false],
    ['Diverted', 'diverted', false],
    // Compound FlightAware strings — base + delay flag, never mashed.
    ['Taxiing / Delayed', 'taxiing', true],
    ['En Route / Delayed', 'en_route', true],
    ['Scheduled / Delayed', 'scheduled', true],
    ['Landed / Delayed', 'arrived', true],
    // Underscore form (previously stored lowercased)
    ['en_route', 'en_route', false],
    ['taxiing_delayed', 'taxiing', true],
    // Bare delayed → still scheduled, flagged
    ['Delayed', 'scheduled', true],
    // Unknown → scheduled
    ['', 'scheduled', false],
    ['something weird', 'scheduled', false],
  ]

  for (const [raw, expected, delayed] of cases) {
    it(`maps "${raw}" → ${expected} (delayed=${delayed})`, () => {
      const r = normalizeStatus(raw)
      expect(r.status).toBe(expected)
      expect(r.delayed).toBe(delayed)
    })
  }

  it('never returns a status containing "/" or "_" beyond the canonical set', () => {
    const inputs = ['Taxiing / Delayed', 'En Route / Delayed', 'foo / bar', 'Landed', 'weird_string_thing']
    const allowed = new Set([
      'scheduled', 'boarding', 'departed', 'en_route', 'taxiing', 'arrived', 'cancelled', 'diverted',
    ])
    for (const i of inputs) {
      const { status } = normalizeStatus(i)
      expect(status).not.toContain('/')
      expect(allowed.has(status)).toBe(true)
    }
  })

  it('produces identical vocabulary for FA-style and ADB-style inputs', () => {
    expect(normalizeStatus('Arrived').status).toBe(normalizeStatus('Landed').status)
    expect(normalizeStatus('EnRoute').status).toBe(normalizeStatus('En Route / Delayed').status)
  })
})
