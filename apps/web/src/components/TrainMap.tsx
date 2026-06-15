import { useEffect, useRef } from 'react'

export interface GtfsStop {
  code: string
  name: string
  lat: number
  lon: number
  scheduledArr?: string // "HH:MM:SS" may exceed 24:00
  scheduledDep?: string
  stopSequence: number
}

interface Props {
  stops: GtfsStop[]
  departureScheduled: string
  status: string
  /** Boarding station code — map viewport focuses on user's segment, not full route */
  origin?: string
  /** Alighting station code */
  destination?: string
}

// Train icon SVG (points up at 0°, matches icon-rotate convention)
const TRAIN_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="40" height="40"><rect x="5" y="2" width="14" height="17" rx="3" fill="#ffffff" stroke="#0a84ff" stroke-width="1.5"/><rect x="8" y="5" width="3.5" height="3.5" rx="0.5" fill="#0a84ff" opacity="0.7"/><rect x="12.5" y="5" width="3.5" height="3.5" rx="0.5" fill="#0a84ff" opacity="0.7"/><rect x="8" y="10" width="8" height="2" rx="0.5" fill="#0a84ff" opacity="0.4"/><circle cx="8" cy="21" r="2.5" fill="#0a84ff"/><circle cx="16" cy="21" r="2.5" fill="#0a84ff"/><line x1="8" y1="19" x2="16" y2="19" stroke="#0a84ff" stroke-width="1.5"/></svg>`
const TRAIN_ICON_URI = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(TRAIN_ICON_SVG)

const EMPTY_FC: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] }

// Parse "HH:MM:SS" time string (hours may exceed 23) relative to a base date,
// returning a Date. Returns null if input is falsy.
function parseGtfsTime(timeStr: string | undefined, baseDate: Date): Date | null {
  if (!timeStr) return null
  const parts = timeStr.split(':')
  if (parts.length < 2) return null
  const h = parseInt(parts[0], 10)
  const m = parseInt(parts[1], 10)
  const s = parseInt(parts[2] ?? '0', 10)
  const d = new Date(baseDate)
  d.setHours(h, m, s, 0)
  return d
}

// Compute where the train currently is along the route.
// Returns [lon, lat] or null.
function computeTrainPosition(
  stops: GtfsStop[],
  departureScheduled: string,
  status: string
): [number, number] | null {
  if (stops.length === 0) return null

  const st = status.toLowerCase().replace(/[\s_]+/g, '-')
  const first = stops[0]
  const last = stops[stops.length - 1]

  if (st === 'arrived' || st === 'landed') {
    return [last.lon, last.lat]
  }
  if (st === 'scheduled' || st === 'boarding' || st === 'delayed' || st === 'cancelled' || st === 'unknown' || st === '') {
    return [first.lon, first.lat]
  }

  // In transit: interpolate by scheduled times
  const baseDate = new Date(departureScheduled)
  // Strip time — base date is just the calendar date
  baseDate.setHours(0, 0, 0, 0)

  const now = Date.now()

  // Find the segment we're on: last stop whose scheduled dep/arr is in the past
  let prevIdx = 0
  for (let i = 0; i < stops.length; i++) {
    const t = parseGtfsTime(stops[i].scheduledDep ?? stops[i].scheduledArr, baseDate)
    if (t && t.getTime() <= now) {
      prevIdx = i
    } else {
      break
    }
  }

  const nextIdx = Math.min(prevIdx + 1, stops.length - 1)
  if (prevIdx === nextIdx) {
    // At or past last stop
    return [stops[nextIdx].lon, stops[nextIdx].lat]
  }

  const prev = stops[prevIdx]
  const next = stops[nextIdx]
  const depTime = parseGtfsTime(prev.scheduledDep ?? prev.scheduledArr, baseDate)
  const arrTime = parseGtfsTime(next.scheduledArr ?? next.scheduledDep, baseDate)

  let frac = 0.5
  if (depTime && arrTime && arrTime.getTime() > depTime.getTime()) {
    frac = Math.max(0, Math.min(1, (now - depTime.getTime()) / (arrTime.getTime() - depTime.getTime())))
  }

  return [
    prev.lon + (next.lon - prev.lon) * frac,
    prev.lat + (next.lat - prev.lat) * frac,
  ]
}

// Determine stop category for coloring: 'past' | 'current' | 'future'
function classifyStops(
  stops: GtfsStop[],
  departureScheduled: string,
  status: string
): ('past' | 'current' | 'future')[] {
  if (stops.length === 0) return []

  const st = status.toLowerCase().replace(/[\s_]+/g, '-')
  if (st === 'arrived' || st === 'landed') {
    return stops.map(() => 'past')
  }
  if (st === 'scheduled' || st === 'boarding' || st === 'delayed' || st === 'cancelled' || st === 'unknown' || st === '') {
    return stops.map((_, i) => (i === 0 ? 'current' : 'future'))
  }

  const baseDate = new Date(departureScheduled)
  baseDate.setHours(0, 0, 0, 0)
  const now = Date.now()

  let lastPassedIdx = -1
  for (let i = 0; i < stops.length; i++) {
    const t = parseGtfsTime(stops[i].scheduledDep ?? stops[i].scheduledArr, baseDate)
    if (t && t.getTime() <= now) lastPassedIdx = i
  }

  return stops.map((_, i) => {
    if (i < lastPassedIdx) return 'past'
    if (i === lastPassedIdx) return 'past'
    if (i === lastPassedIdx + 1) return 'current'
    return 'future'
  })
}

export function TrainMap({ stops, departureScheduled, status, origin, destination }: Props): React.ReactElement | null {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<import('maplibre-gl').Map | null>(null)

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    if (stops.length < 2) return

    let cancelled = false

    void (async () => {
      const maplibre = await import('maplibre-gl')

      if (cancelled || !containerRef.current) return

      const map = new maplibre.Map({
        container: containerRef.current!,
        style: 'https://tiles.openfreemap.org/styles/positron',
        center: [stops[0].lon, stops[0].lat],
        zoom: 5,
        attributionControl: false,
        interactive: false,
      })

      mapRef.current = map

      map.on('load', () => {
        if (cancelled) return

        // ── Clip stops to the user's segment ─────────────────────────────────
        // All stops from the full route are stored, but we only draw and frame
        // the portion the user is actually riding (boarding → alighting).
        const boardingIdx = origin ? stops.findIndex(s => s.code === origin) : -1
        const alightingIdx = destination ? stops.map(s => s.code).lastIndexOf(destination) : -1
        const segmentStops =
          boardingIdx >= 0 && alightingIdx > boardingIdx
            ? stops.slice(boardingIdx, alightingIdx + 1)
            : stops

        // ── Route polyline ────────────────────────────────────────────────────
        const routeCoords = segmentStops.map(s => [s.lon, s.lat] as [number, number])

        map.addSource('train-route', {
          type: 'geojson',
          data: {
            type: 'Feature',
            geometry: { type: 'LineString', coordinates: routeCoords },
            properties: {},
          },
        })

        map.addLayer({
          id: 'train-route-halo',
          type: 'line',
          source: 'train-route',
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': '#0a84ff',
            'line-width': 10,
            'line-opacity': 0.15,
            'line-blur': 4,
          },
        })

        map.addLayer({
          id: 'train-route-line',
          type: 'line',
          source: 'train-route',
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': '#0a84ff',
            'line-width': 2.5,
            'line-opacity': 0.9,
          },
        })

        // ── Stop dots ─────────────────────────────────────────────────────────
        const classifications = classifyStops(segmentStops, departureScheduled, status)

        const stopFeatures = segmentStops.map((s, i) => ({
          type: 'Feature' as const,
          geometry: { type: 'Point' as const, coordinates: [s.lon, s.lat] },
          properties: {
            name: s.name,
            kind: classifications[i], // 'past' | 'current' | 'future'
          },
        }))

        map.addSource('train-stops', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: stopFeatures },
        })

        // Past stops: grey
        map.addLayer({
          id: 'stops-past',
          type: 'circle',
          source: 'train-stops',
          filter: ['==', ['get', 'kind'], 'past'],
          paint: {
            'circle-radius': 4,
            'circle-color': '#8e8e93',
            'circle-stroke-color': '#ffffff',
            'circle-stroke-width': 1.5,
          },
        })

        // Future stops: light blue outline
        map.addLayer({
          id: 'stops-future',
          type: 'circle',
          source: 'train-stops',
          filter: ['==', ['get', 'kind'], 'future'],
          paint: {
            'circle-radius': 4,
            'circle-color': '#ffffff',
            'circle-stroke-color': '#0a84ff',
            'circle-stroke-width': 1.5,
          },
        })

        // Current/next stop: blue highlight
        map.addLayer({
          id: 'stops-current',
          type: 'circle',
          source: 'train-stops',
          filter: ['==', ['get', 'kind'], 'current'],
          paint: {
            'circle-radius': 6,
            'circle-color': '#0a84ff',
            'circle-stroke-color': '#ffffff',
            'circle-stroke-width': 2,
          },
        })

        // ── Train position marker ─────────────────────────────────────────────
        const trainPos = computeTrainPosition(segmentStops, departureScheduled, status)

        const trainImg = new Image(40, 40)
        trainImg.onload = () => {
          if (cancelled) return
          try {
            if (!map.hasImage('train-icon')) map.addImage('train-icon', trainImg)

            map.addSource('train-pos', {
              type: 'geojson',
              data: trainPos
                ? {
                    type: 'FeatureCollection',
                    features: [{
                      type: 'Feature',
                      geometry: { type: 'Point', coordinates: trainPos },
                      properties: {},
                    }],
                  }
                : EMPTY_FC,
            })

            map.addLayer({
              id: 'train-symbol',
              type: 'symbol',
              source: 'train-pos',
              layout: {
                'icon-image': 'train-icon',
                'icon-size': 0.9,
                'icon-allow-overlap': true,
                'icon-ignore-placement': true,
              },
            })
          } catch {
            // map may be tearing down
          }
        }
        trainImg.src = TRAIN_ICON_URI

        // ── Fit bounds to the user's segment ─────────────────────────────────
        const lons = segmentStops.map(s => s.lon)
        const lats = segmentStops.map(s => s.lat)
        try {
          map.fitBounds(
            [[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]],
            { padding: { top: 40, bottom: 40, left: 40, right: 40 }, maxZoom: 9, duration: 0 }
          )
        } catch {
          // ignore
        }
      })
    })()

    return () => {
      cancelled = true
      mapRef.current?.remove()
      mapRef.current = null
    }
  // Re-create map when stops, segment bounds, or status change
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stops, departureScheduled, status, origin, destination])

  if (stops.length < 2) return null

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: 220,
        borderRadius: 16,
        overflow: 'hidden',
        background: '#e8eef4',
        marginBottom: '0.875rem',
      }}
    />
  )
}
