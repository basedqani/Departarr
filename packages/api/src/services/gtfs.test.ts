import { describe, it, expect } from 'vitest'
import {
  localMidnightUtc,
  parseGtfsTime,
  computeStopInstantUtc,
  computeMaxServiceSpanDays,
} from './gtfs.js'

describe('parseGtfsTime', () => {
  it('parses normal times', () => {
    expect(parseGtfsTime('08:50:00')).toBe((8 * 3600 + 50 * 60) * 1000)
  })
  it('parses overflow times beyond 24h', () => {
    expect(parseGtfsTime('56:50:00')).toBe((56 * 3600 + 50 * 60) * 1000)
  })
})

describe('localMidnightUtc', () => {
  it('resolves Central (CDT, UTC-5) midnight in summer', () => {
    expect(localMidnightUtc('2026-06-25', 'America/Chicago').toISOString())
      .toBe('2026-06-25T05:00:00.000Z')
  })
  it('resolves Pacific (PDT, UTC-7) midnight in summer', () => {
    expect(localMidnightUtc('2026-06-25', 'America/Los_Angeles').toISOString())
      .toBe('2026-06-25T07:00:00.000Z')
  })
})

describe('computeStopInstantUtc — Empire Builder Train 8 flagship bug', () => {
  // Train 8 originates Seattle (Pacific) on the service date 2026-06-25 and runs
  // ~2 days. The MSP (St. Paul, Central) boarding stop carries an overflow time
  // measured from the service date's LOCAL MIDNIGHT IN MSP'S OWN ZONE:
  //   2 days + 08:50 = 56:50:00.
  // Anchored to MSP's own tz, this must resolve to 8:50 AM CDT = 13:50Z on Jun 27,
  // NOT the buggy 11:50 AM (16:50Z) produced by anchoring to the Pacific origin.
  it('MSP boarding resolves to 2026-06-27T13:50:00Z (8:50 AM CDT)', () => {
    const inst = computeStopInstantUtc('2026-06-25', 'America/Chicago', '56:50:00')
    expect(inst.toISOString()).toBe('2026-06-27T13:50:00.000Z')
  })

  it('demonstrates the OLD origin-anchored math was wrong', () => {
    // The bug anchored MSP's overflow to the PACIFIC ORIGIN midnight instead of
    // MSP's own zone. Same overflow (56:50), wrong anchor → 2h early (15:50Z),
    // i.e. it ignores the Pacific→Central shift. Must NOT equal the correct 13:50Z.
    const buggy = computeStopInstantUtc('2026-06-25', 'America/Los_Angeles', '56:50:00')
    expect(buggy.toISOString()).toBe('2026-06-27T15:50:00.000Z')
    expect(buggy.toISOString()).not.toBe('2026-06-27T13:50:00.000Z')
  })

  it('no regression: same-day single-tz train (Pacific origin departure)', () => {
    // Coast Starlight-style same-day stop: SEA depart 18:10 PDT on service date.
    const inst = computeStopInstantUtc('2026-06-25', 'America/Los_Angeles', '18:10:00')
    expect(inst.toISOString()).toBe('2026-06-26T01:10:00.000Z') // 18:10 PDT = 01:10Z next day
  })
})

describe('computeMaxServiceSpanDays — dynamic search window', () => {
  it('computes 2 for an Empire-Builder-like feed (max overflow hour 56)', () => {
    const rows = [
      { departure_time: '14:30:00', arrival_time: '14:25:00' },
      { departure_time: '56:50:00', arrival_time: '56:45:00' },
      { departure_time: '', arrival_time: '08:00:00' },
    ]
    expect(computeMaxServiceSpanDays(rows)).toBe(2)
  })
  it('computes 0 for a feed with no overflow (all same-day)', () => {
    const rows = [
      { departure_time: '06:00:00', arrival_time: '05:55:00' },
      { departure_time: '23:59:00', arrival_time: '23:50:00' },
    ]
    expect(computeMaxServiceSpanDays(rows)).toBe(0)
  })
  it('computes 1 for an overnight feed (max hour 25..47)', () => {
    const rows = [{ departure_time: '26:15:00', arrival_time: '26:10:00' }]
    expect(computeMaxServiceSpanDays(rows)).toBe(1)
  })
})
