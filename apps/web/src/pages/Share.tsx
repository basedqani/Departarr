import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { lazy, Suspense, useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { api } from '../lib/api'
import { StatusBadge } from '../components/StatusBadge'
import { formatTime, formatDateTime } from '../lib/format'
import type { AircraftPosition } from '../lib/api'
import { getAirport } from '../lib/airports'

const GlobeMap = lazy(() => import('../components/GlobeMap').then(m => ({ default: m.GlobeMap })))

export function SharePage(): React.ReactElement {
  const { token } = useParams<{ token: string }>()
  const [position, setPosition] = useState<AircraftPosition | null>(null)

  const { data, isLoading, isError } = useQuery({
    queryKey: ['share', token],
    queryFn: () => api.share.get(token!),
    refetchInterval: 30_000,
  })

  const flight = data?.flight

  // Poll live position if we have a flight
  useEffect(() => {
    if (!flight?.id) return
    const poll = async (): Promise<void> => {
      try {
        const pos = await api.flights.position(flight.id)
        setPosition(pos)
      } catch { /* not airborne */ }
    }
    void poll()
    const iv = setInterval(() => void poll(), 30_000)
    return () => clearInterval(iv)
  }, [flight?.id])

  if (isLoading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', color: 'var(--text)' }}>
        <div className="loading">
          <div className="loading-spinner" />
          Loading flight…
        </div>
      </div>
    )
  }

  if (isError || !data || (!data.flight && !data.trip)) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', color: 'var(--text)', padding: '1.5rem' }}>
        <div className="auth-card" style={{ textAlign: 'center' }}>
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.5" style={{ margin: '0 auto 1rem', display: 'block' }}>
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <h2 style={{ fontSize: '1.1rem', marginBottom: '0.5rem' }}>Share link not found</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>This link may have been revoked or is invalid.</p>
        </div>
      </div>
    )
  }

  const originAirport = flight ? getAirport(flight.origin) : null
  const destAirport = flight ? getAirport(flight.destination) : null

  return (
    <div className="share-page">
      {/* Globe hero */}
      {flight && (
        <div style={{ width: '100%', height: '42vh', minHeight: 240, maxHeight: 400, background: 'var(--bg)' }}>
          <Suspense fallback={<div style={{ width: '100%', height: '100%', background: '#05080f' }} />}>
            <GlobeMap
              origin={flight.origin}
              destination={flight.destination}
              position={position}
              departureScheduled={flight.departureScheduled}
              arrivalScheduled={flight.arrivalScheduled}
              status={flight.status}
            />
          </Suspense>
        </div>
      )}

      {/* Content */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        style={{
          maxWidth: 600,
          margin: '0 auto',
          padding: '1.5rem 1rem',
        }}
      >
        {/* Wordmark */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '1.25rem', color: 'var(--text-muted)', fontSize: '0.78rem' }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="var(--accent)">
            <path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z" />
          </svg>
          <span style={{ fontWeight: 700, color: 'var(--text)' }}>Departarr</span>
          <span>· Flight Status</span>
        </div>

        {flight && (
          <div className="card">
            {/* Route */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
              <div>
                <div className="detail-route" style={{ fontSize: '1.9rem' }}>
                  <span>{flight.origin}</span>
                  <span className="detail-route-sep">›</span>
                  <span>{flight.destination}</span>
                </div>
                <div style={{ color: 'var(--text-muted)', fontSize: '0.82rem', marginTop: '0.25rem' }}>
                  {flight.ident}
                  {flight.aircraftType ? ` · ${flight.aircraftType}` : ''}
                </div>
              </div>
              <StatusBadge status={flight.status} />
            </div>

            {/* Airport names */}
            {(originAirport || destAirport) && (
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem', gap: '0.5rem' }}>
                {originAirport && (
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', lineHeight: 1.4 }}>
                    <div style={{ fontWeight: 600, color: 'var(--text-dim)' }}>{originAirport.city}</div>
                    <div style={{ fontSize: '0.68rem' }}>{originAirport.name}</div>
                  </div>
                )}
                {destAirport && (
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', lineHeight: 1.4, textAlign: 'right' }}>
                    <div style={{ fontWeight: 600, color: 'var(--text-dim)' }}>{destAirport.city}</div>
                    <div style={{ fontSize: '0.68rem' }}>{destAirport.name}</div>
                  </div>
                )}
              </div>
            )}

            {/* Times */}
            <div className="info-grid" style={{ marginTop: 0 }}>
              <div className="info-cell">
                <div className="info-cell-label">Departure</div>
                <div className="info-cell-value">{formatTime(flight.departureActual ?? flight.departureEstimated ?? flight.departureScheduled)}</div>
                {(flight.departureEstimated || flight.departureActual) && flight.departureActual !== flight.departureScheduled && (
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textDecoration: 'line-through' }}>{formatTime(flight.departureScheduled)}</div>
                )}
              </div>
              <div className="info-cell">
                <div className="info-cell-label">Arrival</div>
                <div className="info-cell-value">{formatTime(flight.arrivalActual ?? flight.arrivalEstimated ?? flight.arrivalScheduled)}</div>
                {(flight.arrivalEstimated || flight.arrivalActual) && flight.arrivalActual !== flight.arrivalScheduled && (
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textDecoration: 'line-through' }}>{formatTime(flight.arrivalScheduled)}</div>
                )}
              </div>
              {flight.gateDeparture && (
                <div className="info-cell">
                  <div className="info-cell-label">Gate</div>
                  <div className="info-cell-value">{flight.gateDeparture}</div>
                </div>
              )}
              {flight.baggageClaim && (
                <div className="info-cell">
                  <div className="info-cell-label">Baggage</div>
                  <div className="info-cell-value">{flight.baggageClaim}</div>
                </div>
              )}
            </div>

            {/* Recent events */}
            {flight.events && flight.events.length > 0 && (
              <div style={{ marginTop: '1rem' }}>
                <div style={{ fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.09em', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
                  Recent Updates
                </div>
                {flight.events.slice(0, 5).map((ev, i) => (
                  <div key={ev.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.45rem 0', borderBottom: i < 4 ? '1px solid var(--hairline)' : 'none', fontSize: '0.85rem' }}>
                    <span style={{ textTransform: 'capitalize', fontWeight: 500 }}>{ev.eventType.replace(/_/g, ' ')}</span>
                    <span style={{ color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>{formatDateTime(ev.occurredAt)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <p style={{ textAlign: 'center', marginTop: '1.5rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
          Powered by <a href="https://github.com" style={{ color: 'var(--accent)' }}>Departarr</a> · Auto-refreshes every 30s
        </p>
      </motion.div>
    </div>
  )
}
