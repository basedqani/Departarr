import { useEffect, useRef, useCallback } from 'react'
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
const PLANE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="28" height="28" fill="#eaf4ff" style="filter:drop-shadow(0 0 6px #5db4ffcc)"><path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/></svg>`

// Recolor a default vector basemap into a premium "midnight" palette — deep
// ocean blue, near-black land, faint glowing borders. Heuristic by layer id so
// it works across style variants without hardcoding exact layer names.
function applyPremiumTheme(map: import('maplibre-gl').Map): void {
  let layers: Array<{ id: string; type: string }>
  try {
    layers = (map.getStyle()?.layers ?? []) as Array<{ id: string; type: string }>
  } catch {
    return
  }
  for (const layer of layers) {
    const id = layer.id.toLowerCase()
    try {
      if (layer.type === 'background') {
        map.setPaintProperty(layer.id, 'background-color', '#070d1a')
      } else if (id.includes('water') || id.includes('ocean') || id.includes('sea') || id.includes('marine') || id.includes('bathymetry')) {
        if (layer.type === 'fill') map.setPaintProperty(layer.id, 'fill-color', '#0a1e3d')
        else if (layer.type === 'line') map.setPaintProperty(layer.id, 'line-color', '#0a1e3d')
      } else if (id.includes('boundary') || id.includes('admin') || id.includes('border')) {
        if (layer.type === 'line') map.setPaintProperty(layer.id, 'line-color', 'rgba(125,155,205,0.22)')
      } else if (id.includes('land') || id.includes('earth') || id.includes('park') || id.includes('forest') || id.includes('wood') || id.includes('grass')) {
        if (layer.type === 'fill') map.setPaintProperty(layer.id, 'fill-color', '#0c1322')
      }
    } catch {
      // some layers don't accept the property — skip
    }
  }
}

export function GlobeMap({ origin, destination, position, departureScheduled, arrivalScheduled, status }: Props): React.ReactElement {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<import('maplibre-gl').Map | null>(null)
  const markerRef = useRef<import('maplibre-gl').Marker | null>(null)
  // Store the "frame the route" camera action so the recenter button re-runs it
  const frameCameraRef = useRef<((duration?: number) => void) | null>(null)

  const handleRecenter = useCallback(() => {
    frameCameraRef.current?.(900)
  }, [])

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
        interactive: true,
        dragPan: true,
        scrollZoom: true,
        dragRotate: true,
        touchZoomRotate: true,
        keyboard: true,
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

        // Sky / atmosphere for floating-in-space look — bluish horizon glow
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ;(map as any).setFog({
            color: 'rgba(8, 16, 32, 0)',
            'high-color': 'rgba(40, 90, 170, 0.45)',
            'horizon-blend': 0.12,
            'space-color': '#04060d',
            'star-intensity': 0.22,
          })
        } catch {
          // older API — skip
        }

        // Recolor the bland default style into a premium midnight cartography.
        applyPremiumTheme(map)

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

            // Wide soft glow
            if (!map.getLayer('flight-arc-halo')) {
              map.addLayer({
                id: 'flight-arc-halo',
                type: 'line',
                source: 'flight-arc',
                layout: { 'line-cap': 'round', 'line-join': 'round' },
                paint: {
                  'line-color': '#5db4ff',
                  'line-width': 12,
                  'line-opacity': 0.16,
                  'line-blur': 6,
                },
              })
            }

            // Core line — bright, crisp
            if (!map.getLayer('flight-arc-line')) {
              map.addLayer({
                id: 'flight-arc-line',
                type: 'line',
                source: 'flight-arc',
                layout: { 'line-cap': 'round', 'line-join': 'round' },
                paint: {
                  'line-color': '#8fd0ff',
                  'line-width': 2.5,
                  'line-opacity': 0.95,
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

            // Soft glow under the airport dots
            if (!map.getLayer('airport-glow')) {
              map.addLayer({
                id: 'airport-glow',
                type: 'circle',
                source: 'airports',
                paint: {
                  'circle-radius': 12,
                  'circle-color': '#5db4ff',
                  'circle-opacity': 0.18,
                  'circle-blur': 1,
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
                  'circle-color': '#eaf4ff',
                  'circle-opacity': 1,
                  'circle-stroke-color': '#5db4ff',
                  'circle-stroke-width': 2.5,
                },
              })
            }

            // Camera: tightly frame the two airports so the route fills the
            // view instead of floating as a tiny line on a whole continent.
            type Coord = [number, number]
            const raw = arc.geometry.coordinates as Coord[] | Coord[][]
            const isMulti = Array.isArray(raw[0][0])

            const frame = (duration = 1200): void => {
              try {
                if (isMulti) {
                  // Antimeridian-crossing (e.g. LAX→NRT): fitBounds breaks
                  // (spans ±180 → world bbox), so ease to the longer segment's
                  // midpoint at a distance-appropriate zoom.
                  const segs = raw as Coord[][]
                  const longest = segs.reduce((a, b) => (a.length >= b.length ? a : b))
                  const mid = longest[Math.floor(longest.length / 2)]
                  const allLats = segs.flat().map(c => c[1])
                  const latSpan = Math.max(...allLats) - Math.min(...allLats)
                  const zoom = latSpan > 35 ? 1.4 : latSpan > 20 ? 1.9 : 2.6
                  map.easeTo({ center: [mid[0], mid[1]], zoom, duration })
                } else {
                  // Normal route: fit both airports with breathing room. maxZoom
                  // keeps short hops (e.g. MSP→ORD) from zooming in too far.
                  const lons = [originAirport.lon, destAirport.lon]
                  const lats = [originAirport.lat, destAirport.lat]
                  map.fitBounds(
                    [[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]],
                    { padding: { top: 80, bottom: 110, left: 70, right: 70 }, maxZoom: 5.2, duration }
                  )
                }
              } catch {
                // ignore camera errors
              }
            }

            frameCameraRef.current = frame
            frame()
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
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div
        ref={containerRef}
        style={{
          width: '100%',
          height: '100%',
          background: '#05080f',
        }}
      />
      {/* Recenter button */}
      <button
        onClick={handleRecenter}
        aria-label="Re-center map"
        style={{
          position: 'absolute',
          bottom: '0.75rem',
          right: '0.75rem',
          zIndex: 10,
          width: 36,
          height: 36,
          borderRadius: '50%',
          background: 'rgba(13,19,32,0.72)',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
          border: '1px solid rgba(255,255,255,0.12)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          padding: 0,
          color: 'rgba(232,237,245,0.8)',
          boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
          transition: 'background 0.15s',
        }}
      >
        {/* Lucide Locate icon */}
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="2" y1="12" x2="5" y2="12" />
          <line x1="19" y1="12" x2="22" y2="12" />
          <line x1="12" y1="2" x2="12" y2="5" />
          <line x1="12" y1="19" x2="12" y2="22" />
          <circle cx="12" cy="12" r="4" />
        </svg>
      </button>
    </div>
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
