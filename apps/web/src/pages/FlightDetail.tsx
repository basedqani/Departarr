import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { api } from '../lib/api'
import { StatusBadge } from '../components/StatusBadge'
import { formatTime, formatDateTime, timeAgo } from '../lib/format'
import type { AircraftPosition } from '../lib/api'

type LeafletMap = import('leaflet').Map
type LeafletMarker = import('leaflet').Marker
type LeafletLib = typeof import('leaflet')

const STATUS_STEPS = [
  { key: 'scheduled', label: 'Scheduled' },
  { key: 'boarding', label: 'Boarding' },
  { key: 'departed', label: 'Departed' },
  { key: 'en-route', label: 'En Route' },
  { key: 'landed', label: 'Landed' },
  { key: 'arrived', label: 'Arrived' },
]

function getStepIndex(status: string): number {
  const idx = STATUS_STEPS.findIndex(s => s.key === status.toLowerCase().replace('_', '-'))
  return idx === -1 ? 0 : idx
}

function FlightMap({ flightId, registration }: { flightId: string; registration: string | null }): React.ReactElement {
  const mapRef = useRef<HTMLDivElement>(null)
  const mapInstanceRef = useRef<LeafletMap | null>(null)
  const markerRef = useRef<LeafletMarker | null>(null)
  const leafletRef = useRef<LeafletLib | null>(null)
  const [position, setPosition] = useState<AircraftPosition | null>(null)

  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return

    void (async () => {
      const L = (await import('leaflet')) as LeafletLib
      leafletRef.current = L
      const map = L.map(mapRef.current!).setView([40, -98], 4)
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
      }).addTo(map)
      mapInstanceRef.current = map
    })()

    return () => {
      mapInstanceRef.current?.remove()
      mapInstanceRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!registration) return
    const poll = async (): Promise<void> => {
      try {
        const pos = await api.flights.position(flightId)
        setPosition(pos)
      } catch { /* not in air */ }
    }
    void poll()
    const interval = setInterval(() => void poll(), 30_000)
    return () => clearInterval(interval)
  }, [flightId, registration])

  useEffect(() => {
    const L = leafletRef.current
    const map = mapInstanceRef.current
    if (!L || !map || !position) return

    const { latitude: lat, longitude: lng, heading } = position
    if (markerRef.current) {
      markerRef.current.setLatLng([lat, lng])
    } else {
      const icon = L.divIcon({
        html: `<div style="font-size:24px;transform:rotate(${heading}deg)">✈</div>`,
        className: '',
        iconSize: [24, 24],
        iconAnchor: [12, 12],
      })
      markerRef.current = L.marker([lat, lng], { icon }).addTo(map)
      map.setView([lat, lng], 6)
    }
  }, [position])

  return (
    <>
      <div ref={mapRef} className="map-container" />
      {position && (
        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
          {position.altitude > 0 ? `${Math.round(position.altitude)}m altitude · ` : ''}
          {Math.round(position.velocity * 3.6)} km/h · Updated {timeAgo(new Date(position.lastContact * 1000).toISOString())}
        </p>
      )}
    </>
  )
}

export function FlightDetailPage(): React.ReactElement {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [shareUrl, setShareUrl] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  const { data: flight, isLoading } = useQuery({
    queryKey: ['flight', id],
    queryFn: () => api.flights.get(id!),
    refetchInterval: 60_000,
  })

  if (isLoading) return <div className="loading">Loading…</div>
  if (!flight) return <div className="error-box">Flight not found</div>

  const stepIdx = getStepIndex(flight.status)

  async function handleDelete(): Promise<void> {
    if (!confirm('Delete this flight?')) return
    setDeleting(true)
    try {
      await api.flights.delete(id!)
      await queryClient.invalidateQueries({ queryKey: ['flights'] })
      navigate(-1)
    } catch { setDeleting(false) }
  }

  async function handleShare(): Promise<void> {
    try {
      const res = await api.flights.share(id!)
      setShareUrl(res.url)
    } catch { /* noop */ }
  }

  return (
    <>
      <div className="page-header">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <h1>{flight.origin} → {flight.destination}</h1>
            <StatusBadge status={flight.status} />
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginTop: '0.25rem' }}>
            {flight.ident}{flight.aircraftType ? ` · ${flight.aircraftType}` : ''}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button className="secondary" onClick={() => void handleShare()}>Share</button>
          <button className="danger" onClick={() => void handleDelete()} disabled={deleting}>Delete</button>
        </div>
      </div>

      {shareUrl && (
        <div className="card" style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <span style={{ flex: 1, fontSize: '0.85rem', wordBreak: 'break-all' }}>{shareUrl}</span>
          <button className="secondary" style={{ whiteSpace: 'nowrap' }} onClick={() => { void navigator.clipboard.writeText(shareUrl) }}>Copy</button>
        </div>
      )}

      {/* Status timeline */}
      <div className="card" style={{ marginBottom: '1rem' }}>
        <h2 style={{ fontSize: '0.95rem', marginBottom: '1rem' }}>Status</h2>
        <div className="timeline">
          {STATUS_STEPS.map((step, i) => {
            const done = i < stepIdx
            const active = i === stepIdx
            return (
              <div key={step.key} className="timeline-item">
                <div className={`timeline-dot${done ? ' done' : active ? ' active' : ''}`} />
                <div className="timeline-label">{step.label}</div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Live map */}
      <FlightMap flightId={flight.id} registration={flight.registration} />

      {/* Info grid */}
      <div className="info-grid">
        <div className="info-cell">
          <div className="info-cell-label">Departure</div>
          <div className="info-cell-value">{formatTime(flight.departureActual ?? flight.departureEstimated ?? flight.departureScheduled)}</div>
          {(flight.departureEstimated || flight.departureActual) && (
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Sched {formatTime(flight.departureScheduled)}</div>
          )}
        </div>
        <div className="info-cell">
          <div className="info-cell-label">Arrival</div>
          <div className="info-cell-value">{formatTime(flight.arrivalActual ?? flight.arrivalEstimated ?? flight.arrivalScheduled)}</div>
          {(flight.arrivalEstimated || flight.arrivalActual) && (
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Sched {formatTime(flight.arrivalScheduled)}</div>
          )}
        </div>
        {flight.gateDeparture && (
          <div className="info-cell">
            <div className="info-cell-label">Dep Gate</div>
            <div className="info-cell-value">{flight.gateDeparture}</div>
          </div>
        )}
        {flight.gateArrival && (
          <div className="info-cell">
            <div className="info-cell-label">Arr Gate</div>
            <div className="info-cell-value">{flight.gateArrival}</div>
          </div>
        )}
        {flight.terminalDeparture && (
          <div className="info-cell">
            <div className="info-cell-label">Dep Terminal</div>
            <div className="info-cell-value">{flight.terminalDeparture}</div>
          </div>
        )}
        {flight.terminalArrival && (
          <div className="info-cell">
            <div className="info-cell-label">Arr Terminal</div>
            <div className="info-cell-value">{flight.terminalArrival}</div>
          </div>
        )}
        {flight.baggageClaim && (
          <div className="info-cell">
            <div className="info-cell-label">Baggage</div>
            <div className="info-cell-value">{flight.baggageClaim}</div>
          </div>
        )}
        {flight.aircraftType && (
          <div className="info-cell">
            <div className="info-cell-label">Aircraft</div>
            <div className="info-cell-value">{flight.aircraftType}</div>
          </div>
        )}
        {flight.registration && (
          <div className="info-cell">
            <div className="info-cell-label">Registration</div>
            <div className="info-cell-value">{flight.registration}</div>
          </div>
        )}
      </div>

      {/* Event history */}
      {flight.events.length > 0 && (
        <div className="card" style={{ marginTop: '1rem' }}>
          <h2 style={{ fontSize: '0.95rem', marginBottom: '1rem' }}>Updates</h2>
          {flight.events.map(ev => (
            <div key={ev.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem 0', borderBottom: '1px solid var(--border)' }}>
              <div>
                <span style={{ fontSize: '0.85rem', textTransform: 'capitalize' }}>{ev.eventType.replace(/_/g, ' ')}</span>
                {ev.oldValue && ev.newValue && (
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginLeft: '0.5rem' }}>
                    {ev.oldValue} → {ev.newValue}
                  </span>
                )}
              </div>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{formatDateTime(ev.occurredAt)}</span>
            </div>
          ))}
        </div>
      )}
    </>
  )
}
