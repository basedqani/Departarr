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
  expanded?: boolean
  onExpandToggle?: () => void
}

// Plane icon for the GL symbol layer. Rendered in the map's own coordinate
// space (unlike an HTML Marker, which mis-projects on the globe), so it always
// sits exactly on the arc. Points "up" (north) at 0° so icon-rotate == heading.
const PLANE_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="48" height="48"><path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z" fill="#ffffff" stroke="#0a84ff" stroke-width="0.6"/></svg>`
const PLANE_ICON_URI = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(PLANE_ICON_SVG)

const EMPTY_FC = { type: 'FeatureCollection' as const, features: [] }

// Push the computed plane position into the GL 'plane' source (no-op until the
// source exists). Setting GeoJSON data is how a symbol layer "moves".
function applyPlane(
  map: import('maplibre-gl').Map,
  opts: Parameters<typeof computePlanePosition>[0],
  arcCoords?: [number, number][] | null
): void {
  const src = map.getSource('plane') as { setData?: (d: unknown) => void } | undefined
  if (!src || typeof src.setData !== 'function') return
  const pos = computePlanePosition(opts, arcCoords)
  if (!pos) { src.setData(EMPTY_FC); return }
  src.setData({
    type: 'FeatureCollection',
    features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [pos.lon, pos.lat] }, properties: { heading: pos.heading ?? 0 } }],
  })
}


export function GlobeMap({ origin, destination, position, departureScheduled, arrivalScheduled, status, expanded, onExpandToggle }: Props): React.ReactElement {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<import('maplibre-gl').Map | null>(null)
  // Flattened great-circle coords, so the plane can ride the actual arc
  const arcCoordsRef = useRef<[number, number][] | null>(null)
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
    let roRef: ResizeObserver | null = null

    void (async () => {
      const maplibre = await import('maplibre-gl')
      const Map = maplibre.Map

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
        dragRotate: false,
        touchZoomRotate: true,
        keyboard: true,
        pitchWithRotate: false,
      })

      mapRef.current = map

      // Fix white/blank map on first open: re-read the actual DOM dimensions
      // after the load event fires (the container may have been 0px during init).
      roRef = new ResizeObserver(() => { map.resize() })
      if (containerRef.current) roRef.observe(containerRef.current)

      map.on('load', () => {
        if (cancelled) return
        map.resize()

        if (!originAirport || !destAirport) return

        // Great-circle arc via turf (statically imported at file top)
        void (async () => {
          try {
            const start = point([originAirport.lon, originAirport.lat])
            const end = point([destAirport.lon, destAirport.lat])
            const arc = greatCircle(start, end, { npoints: 100 })

            // Turf splits the arc into a MultiLineString at the antimeridian
            // (±180°), leaving a visible gap in the line. Fix: unwrap the second
            // segment's longitudes by ±360° so the whole route is one continuous
            // LineString. MapLibre Mercator handles coords outside [-180,180].
            const rawCoords = arc.geometry.coordinates as [number, number][] | [number, number][][]
            const isMultiSeg = Array.isArray(rawCoords[0][0])
            let arcCoords: [number, number][]
            if (isMultiSeg) {
              const segs = rawCoords as [number, number][][]
              const lastLon = segs[0][segs[0].length - 1][0]
              const firstLon = segs[1][0][0]
              // Choose the offset that keeps the second segment continuous
              const offset = Math.abs(lastLon + 360 - firstLon) < Math.abs(lastLon - 360 - firstLon) ? 360 : -360
              const unwrapped = segs[1].map(([lon, lat]) => [lon + offset, lat] as [number, number])
              arcCoords = [...segs[0] as [number, number][], ...unwrapped]
            } else {
              arcCoords = rawCoords as [number, number][]
            }
            arcCoordsRef.current = arcCoords

            const continuousArc: GeoJSON.Feature<GeoJSON.LineString> = {
              type: 'Feature',
              geometry: { type: 'LineString', coordinates: arcCoords },
              properties: {},
            }

            // Add source
            if (!map.getSource('flight-arc')) {
              map.addSource('flight-arc', {
                type: 'geojson',
                data: continuousArc,
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
                  'line-color': '#0a84ff',
                  'line-width': 12,
                  'line-opacity': 0.18,
                  'line-blur': 6,
                },
              })
            }

            // Core line — bright, crisp teal (the "in-motion" accent)
            if (!map.getLayer('flight-arc-line')) {
              map.addLayer({
                id: 'flight-arc-line',
                type: 'line',
                source: 'flight-arc',
                layout: { 'line-cap': 'round', 'line-join': 'round' },
                paint: {
                  'line-color': '#0a84ff',
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
                  'circle-color': '#0a84ff',
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
                  'circle-color': '#ffffff',
                  'circle-opacity': 1,
                  'circle-stroke-color': '#0a84ff',
                  'circle-stroke-width': 2.5,
                },
              })
            }

            // Camera: frame the route. For antimeridian routes the unwrapped
            // coords span past ±180 so fitBounds would wrap the world — detect
            // this and fall back to an easeTo on the arc midpoint instead.
            const frame = (duration = 1200): void => {
              try {
                const lons = arcCoords.map(c => c[0])
                const lats = arcCoords.map(c => c[1])
                const lonSpan = Math.max(...lons) - Math.min(...lons)

                if (lonSpan > 180) {
                  // Antimeridian-crossing: ease to midpoint at distance-based zoom
                  const mid = arcCoords[Math.floor(arcCoords.length / 2)]
                  const latSpan = Math.max(...lats) - Math.min(...lats)
                  const zoom = latSpan > 35 ? 1.4 : latSpan > 20 ? 1.9 : 2.6
                  map.easeTo({ center: [mid[0], mid[1]], zoom, duration })
                } else {
                  // Normal route: fit both airports with breathing room.
                  const aLons = [originAirport.lon, destAirport.lon]
                  const aLats = [originAirport.lat, destAirport.lat]
                  map.fitBounds(
                    [[Math.min(...aLons), Math.min(...aLats)], [Math.max(...aLons), Math.max(...aLats)]],
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

        // Plane as a GL symbol layer (projects correctly on the globe).
        const planeImg = new Image(48, 48)
        planeImg.onload = () => {
          if (cancelled) return
          try {
            if (!map.hasImage('plane-icon')) map.addImage('plane-icon', planeImg)
            if (!map.getSource('plane')) map.addSource('plane', { type: 'geojson', data: EMPTY_FC })
            if (!map.getLayer('plane-symbol')) {
              map.addLayer({
                id: 'plane-symbol',
                type: 'symbol',
                source: 'plane',
                layout: {
                  'icon-image': 'plane-icon',
                  'icon-size': 0.62,
                  'icon-rotate': ['get', 'heading'],
                  'icon-rotation-alignment': 'map',
                  'icon-allow-overlap': true,
                  'icon-ignore-placement': true,
                },
              })
            }
            // Initial placement (deferred so arc coords are populated first).
            setTimeout(() => {
              if (!cancelled) applyPlane(map, { origin, destination, position, departureScheduled, arrivalScheduled, status }, arcCoordsRef.current)
            }, 0)
          } catch {
            // ignore — map may be tearing down
          }
        }
        planeImg.src = PLANE_ICON_URI
      })
    })()

    return () => {
      cancelled = true
      roRef?.disconnect()
      mapRef.current?.remove()
      mapRef.current = null
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [origin, destination])

  // Update plane position on position prop / status change, and keep an
  // in-flight aircraft drifting along the arc between data refreshes.
  useEffect(() => {
    const place = (): void => {
      const map = mapRef.current
      if (!map) return
      applyPlane(map, { origin, destination, position, departureScheduled, arrivalScheduled, status }, arcCoordsRef.current)
    }
    place()

    const st = (status ?? '').toLowerCase().replace(/[\s_]+/g, '-')
    const inAir = st === 'departed' || st === 'en-route'
    if (!inAir) return
    const id = setInterval(place, 20_000)
    return () => clearInterval(id)
  }, [position, origin, destination, departureScheduled, arrivalScheduled, status])

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div
        ref={containerRef}
        style={{
          width: '100%',
          height: '100%',
          background: '#e8eef4',
        }}
      />
      {/* Globe controls: expand + recenter */}
      <div style={{
        position: 'absolute',
        bottom: '0.75rem',
        right: '0.75rem',
        zIndex: 10,
        display: 'flex',
        flexDirection: 'column',
        gap: '0.4rem',
      }}>
        {/* Expand / collapse button */}
        {onExpandToggle && (
          <button
            onClick={onExpandToggle}
            aria-label={expanded ? 'Collapse map' : 'Expand map'}
            style={{
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
            {expanded ? (
              /* Collapse: chevrons pointing inward */
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="4 14 10 14 10 20" />
                <polyline points="20 10 14 10 14 4" />
                <line x1="10" y1="14" x2="3" y2="21" />
                <line x1="21" y1="3" x2="14" y2="10" />
              </svg>
            ) : (
              /* Expand: arrows pointing outward */
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 3 21 3 21 9" />
                <polyline points="9 21 3 21 3 15" />
                <line x1="21" y1="3" x2="14" y2="10" />
                <line x1="3" y1="21" x2="10" y2="14" />
              </svg>
            )}
          </button>
        )}

        {/* Recenter button */}
        <button
          onClick={handleRecenter}
          aria-label="Re-center map"
          style={{
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
    </div>
  )
}

interface PlanePos {
  lat: number
  lon: number
  heading?: number
}

function headingBetween(a: [number, number], b: [number, number]): number {
  // a, b are [lon, lat]
  return (Math.atan2(b[0] - a[0], b[1] - a[1]) * 180) / Math.PI
}

// Rough great-circle distance in km (haversine) — used to sanity-check a live
// ADS-B position against the planned route.
function distanceKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371
  const dLat = ((bLat - aLat) * Math.PI) / 180
  const dLon = ((bLon - aLon) * Math.PI) / 180
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)))
}

// Is the live position plausibly ON this route? OpenSky callsign matching can
// grab the wrong aircraft, which dropped the plane off the arc entirely. We
// accept the live fix only if it's within ~250km of some point on the arc.
function positionOnArc(lat: number, lon: number, arcCoords?: [number, number][] | null): boolean {
  if (!arcCoords || arcCoords.length === 0) return false
  let min = Infinity
  for (const [aLon, aLat] of arcCoords) {
    const d = distanceKm(lat, lon, aLat, aLon)
    if (d < min) min = d
    if (min < 250) return true
  }
  return min < 250
}

function computePlanePosition(
  opts: {
    origin: string
    destination: string
    position?: AircraftPosition | null
    departureScheduled?: string
    arrivalScheduled?: string
    status?: string
  },
  arcCoords?: [number, number][] | null
): PlanePos | null {
  const { position, origin, destination, departureScheduled, arrivalScheduled, status } = opts
  const st = (status ?? '').toLowerCase().replace(/[\s_]+/g, '-')
  const orig = getAirport(origin)
  const dest = getAirport(destination)

  // STATUS WINS over any live position. A not-yet-departed (or already-landed)
  // flight must sit at its endpoint — never at a stray ADS-B callsign match
  // from a different aircraft (which used to drop the plane in the Pacific).
  if (st === 'arrived' || st === 'landed') {
    return dest ? { lat: dest.lat, lon: dest.lon } : null
  }
  if (st === 'scheduled' || st === 'boarding' || st === 'delayed' || st === 'cancelled' || st === 'unknown' || st === '') {
    return orig ? { lat: orig.lat, lon: orig.lon } : null
  }

  // In the air (departed / en-route): a real live position is best — BUT only
  // trust it when it actually lies on the planned route. A stray callsign match
  // (e.g. plane shown over Morocco for an ORD→FRA flight) is rejected in favour
  // of riding the arc.
  if (
    position && position.latitude && position.longitude && !position.onGround &&
    positionOnArc(position.latitude, position.longitude, arcCoords)
  ) {
    return { lat: position.latitude, lon: position.longitude, heading: position.heading }
  }

  // …otherwise ride the great-circle arc by time fraction.
  let frac = 0
  if (departureScheduled && arrivalScheduled) {
    const dep = new Date(departureScheduled).getTime()
    const arr = new Date(arrivalScheduled).getTime()
    const now = Date.now()
    if (arr > dep) frac = Math.max(0, Math.min(1, (now - dep) / (arr - dep)))
  }

  if (arcCoords && arcCoords.length > 1) {
    const lastIdx = arcCoords.length - 1
    const i = Math.max(0, Math.min(lastIdx, Math.round(frac * lastIdx)))
    const p = arcCoords[i]
    const next = arcCoords[Math.min(lastIdx, i + 1)]
    return { lat: p[1], lon: p[0], heading: headingBetween(p, next) }
  }

  // Fallback: straight-line interpolation if the arc isn't ready yet.
  if (orig && dest) {
    return {
      lat: orig.lat + (dest.lat - orig.lat) * frac,
      lon: orig.lon + (dest.lon - orig.lon) * frac,
      heading: headingBetween([orig.lon, orig.lat], [dest.lon, dest.lat]),
    }
  }
  return null
}
