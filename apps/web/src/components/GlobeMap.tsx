import { useEffect, useRef } from 'react'
import greatCircle from '@turf/great-circle'
import { point } from '@turf/helpers'
import type { AircraftPosition } from '../lib/api'
import { getAirport } from '../lib/airports'

interface Props {
  origin: string
  destination: string
  position?: AircraftPosition | null
  departureScheduled?: string
  arrivalScheduled?: string
  status?: string
}

// Plane SVG used as marker HTML
const PLANE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="28" height="28" fill="#4da8ff" style="filter:drop-shadow(0 0 6px #4da8ff99)"><path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/></svg>`

export function GlobeMap({ origin, destination, position, departureScheduled, arrivalScheduled, status }: Props): React.ReactElement {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<import('maplibre-gl').Map | null>(null)
  const markerRef = useRef<import('maplibre-gl').Marker | null>(null)

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    const originAirport = getAirport(origin)
    const destAirport = getAirport(destination)

    // Map creation is async (dynamic import); if the effect is cleaned up
    // before it completes, the orphaned map must be removed or it leaks into
    // the container alongside the replacement.
    let cancelled = false

    void (async () => {
      const maplibre = await import('maplibre-gl')
      const Map = maplibre.Map
      const Marker = maplibre.Marker

      if (cancelled || !containerRef.current) return

      const map = new Map({
        container: containerRef.current!,
        style: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
        center: [0, 20],
        zoom: 1.5,
        attributionControl: false,
        interactive: false,
        pitchWithRotate: false,
      })

      mapRef.current = map

      map.on('load', () => {
        if (cancelled) return
        // Globe projection (MapLibre v5)
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ;(map as any).setProjection({ type: 'globe' })
        } catch {
          // fallback: mercator is fine
        }

        // Sky / atmosphere for floating-in-space look
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ;(map as any).setFog({
            color: 'rgba(5, 8, 15, 0)',
            'high-color': 'rgba(5, 8, 15, 0.9)',
            'horizon-blend': 0.08,
            'space-color': '#05080f',
            'star-intensity': 0.15,
          })
        } catch {
          // older API — skip
        }

        if (!originAirport || !destAirport) return

        // Great-circle arc via turf (statically imported at file top)
        void (async () => {
          try {
            const start = point([originAirport.lon, originAirport.lat])
            const end = point([destAirport.lon, destAirport.lat])
            const arc = greatCircle(start, end, { npoints: 100 })

            // Add source
            if (!map.getSource('flight-arc')) {
              map.addSource('flight-arc', {
                type: 'geojson',
                data: arc,
              })
            }

            // Halo layer
            if (!map.getLayer('flight-arc-halo')) {
              map.addLayer({
                id: 'flight-arc-halo',
                type: 'line',
                source: 'flight-arc',
                layout: { 'line-cap': 'round', 'line-join': 'round' },
                paint: {
                  'line-color': '#4da8ff',
                  'line-width': 8,
                  'line-opacity': 0.12,
                },
              })
            }

            // Core line
            if (!map.getLayer('flight-arc-line')) {
              map.addLayer({
                id: 'flight-arc-line',
                type: 'line',
                source: 'flight-arc',
                layout: { 'line-cap': 'round', 'line-join': 'round' },
                paint: {
                  'line-color': '#4da8ff',
                  'line-width': 2.5,
                  'line-opacity': 0.9,
                },
              })
            }

            // Airport dot source
            if (!map.getSource('airports')) {
              map.addSource('airports', {
                type: 'geojson',
                data: {
                  type: 'FeatureCollection',
                  features: [
                    { type: 'Feature', geometry: { type: 'Point', coordinates: [originAirport.lon, originAirport.lat] }, properties: { label: originAirport.iata } },
                    { type: 'Feature', geometry: { type: 'Point', coordinates: [destAirport.lon, destAirport.lat] }, properties: { label: destAirport.iata } },
                  ],
                },
              })
            }

            if (!map.getLayer('airport-dots')) {
              map.addLayer({
                id: 'airport-dots',
                type: 'circle',
                source: 'airports',
                paint: {
                  'circle-radius': 5,
                  'circle-color': '#4da8ff',
                  'circle-opacity': 0.9,
                  'circle-stroke-color': '#05080f',
                  'circle-stroke-width': 2,
                },
              })
            }

            // Camera: center on arc midpoint. fitBounds breaks for
            // antimeridian-crossing routes (lat/lon span ±180 → world bbox).
            // turf returns a MultiLineString when the arc splits at ±180, so
            // coords may be [[...pairs...], [...pairs...]] rather than [...pairs].
            // Flatten to a single list of [lon, lat] pairs before picking the mid.
            type Coord = [number, number]
            const raw = arc.geometry.coordinates as Coord[] | Coord[][]
            const isMulti = Array.isArray(raw[0][0])
            const flatCoords: Coord[] = isMulti
              ? (raw as Coord[][]).flat()
              : (raw as Coord[])
            // For MultiLineString (antimeridian split), use the longer segment's
            // midpoint so the camera lands over the main arc, not the seam.
            let mid: Coord
            if (isMulti) {
              const segs = raw as Coord[][]
              const longest = segs.reduce((a, b) => a.length >= b.length ? a : b)
              mid = longest[Math.floor(longest.length / 2)]
            } else {
              mid = flatCoords[Math.floor(flatCoords.length / 2)]
            }
            const lats = flatCoords.map(c => c[1])
            const latSpan = Math.max(...lats) - Math.min(...lats)
            // Globe projection in a 45vh hero: zoom out aggressively so the arc
            // fits. Short domestic routes need ~2.5, long-haul ~1.0.
            const zoom = latSpan > 35 ? 0.8 : latSpan > 20 ? 1.5 : 2.5
            try {
              map.easeTo({ center: [mid[0], mid[1]], zoom, duration: 1200 })
            } catch {
              // ignore
            }
          } catch {
            // arc computation failed — skip
          }
        })()

        // Plane marker
        const planeEl = document.createElement('div')
        planeEl.style.cssText = 'pointer-events:none;transform-origin:center center;'
        planeEl.innerHTML = PLANE_SVG

        // rotationAlignment 'map' keeps the plane pointed along its course as
        // the camera moves; rotation must go through setRotation — writing
        // style.transform directly would clobber MapLibre's positioning.
        const marker = new Marker({ element: planeEl, anchor: 'center', rotationAlignment: 'map' })
        markerRef.current = marker

        // Position plane
        const planePos = computePlanePosition({ origin, destination, position, departureScheduled, arrivalScheduled, status })
        if (planePos) {
          marker.setLngLat([planePos.lon, planePos.lat])
          if (planePos.heading !== undefined) {
            marker.setRotation(planePos.heading)
          }
          marker.addTo(map)
        }
      })
    })()

    return () => {
      cancelled = true
      markerRef.current?.remove()
      markerRef.current = null
      mapRef.current?.remove()
      mapRef.current = null
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [origin, destination])

  // Update plane position on position prop change
  useEffect(() => {
    const map = mapRef.current
    const marker = markerRef.current
    if (!map || !marker) return

    const planePos = computePlanePosition({ origin, destination, position, departureScheduled, arrivalScheduled, status })
    if (planePos) {
      marker.setLngLat([planePos.lon, planePos.lat])
      if (planePos.heading !== undefined) {
        marker.setRotation(planePos.heading)
      }
      marker.addTo(map)
    }
  }, [position, origin, destination, departureScheduled, arrivalScheduled, status])

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: '100%',
        background: '#05080f',
      }}
    />
  )
}

interface PlanePos {
  lat: number
  lon: number
  heading?: number
}

function computePlanePosition(opts: {
  origin: string
  destination: string
  position?: AircraftPosition | null
  departureScheduled?: string
  arrivalScheduled?: string
  status?: string
}): PlanePos | null {
  const { position, origin, destination, departureScheduled, arrivalScheduled, status } = opts

  // Live position available
  if (position && position.latitude && position.longitude) {
    return { lat: position.latitude, lon: position.longitude, heading: position.heading }
  }

  const st = (status ?? '').toLowerCase()
  if (st === 'landed' || st === 'arrived') {
    const dest = getAirport(destination)
    if (dest) return { lat: dest.lat, lon: dest.lon }
  }
  if (st === 'scheduled' || st === 'boarding') {
    const orig = getAirport(origin)
    if (orig) return { lat: orig.lat, lon: orig.lon }
  }

  // Interpolate along arc by time fraction
  if (departureScheduled && arrivalScheduled) {
    const dep = new Date(departureScheduled).getTime()
    const arr = new Date(arrivalScheduled).getTime()
    const now = Date.now()
    if (dep <= now && now <= arr) {
      const frac = Math.max(0, Math.min(1, (now - dep) / (arr - dep)))
      const orig = getAirport(origin)
      const dest = getAirport(destination)
      if (orig && dest) {
        const lat = orig.lat + (dest.lat - orig.lat) * frac
        const lon = orig.lon + (dest.lon - orig.lon) * frac
        const heading = Math.atan2(dest.lon - orig.lon, dest.lat - orig.lat) * 180 / Math.PI
        return { lat, lon, heading }
      }
    }
  }

  return null
}
