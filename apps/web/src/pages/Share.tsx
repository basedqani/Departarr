import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'
import { StatusBadge } from '../components/StatusBadge'
import { formatTime, formatDateTime } from '../lib/format'

export function SharePage(): React.ReactElement {
  const { token } = useParams<{ token: string }>()

  const { data, isLoading, isError } = useQuery({
    queryKey: ['share', token],
    queryFn: () => api.share.get(token!),
    refetchInterval: 30_000,
  })

  if (isLoading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', color: 'var(--text)' }}>
        <div className="loading">Loading flight status…</div>
      </div>
    )
  }

  if (isError || !data || (!data.flight && !data.trip)) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', color: 'var(--text)' }}>
        <div className="card" style={{ textAlign: 'center', padding: '3rem' }}>
          <h2>Share link not found</h2>
          <p style={{ color: 'var(--text-muted)', marginTop: '0.5rem' }}>This link may have been revoked or is invalid.</p>
        </div>
      </div>
    )
  }

  const { flight } = data

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--text)', fontFamily: 'var(--font)', padding: '1rem' }}>
      <div style={{ maxWidth: 600, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', padding: '2rem 0 1rem' }}>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>✈ Departarr · Flight Status</p>
        </div>

        {flight && (
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
              <div className="flight-route" style={{ fontSize: '2rem' }}>
                <span>{flight.origin}</span>
                <span className="flight-route-arrow">→</span>
                <span>{flight.destination}</span>
              </div>
              <StatusBadge status={flight.status} />
            </div>

            <p style={{ color: 'var(--text-muted)', marginBottom: '1rem' }}>{flight.ident}</p>

            <div className="info-grid">
              <div className="info-cell">
                <div className="info-cell-label">Departure</div>
                <div className="info-cell-value">{formatTime(flight.departureActual ?? flight.departureEstimated ?? flight.departureScheduled)}</div>
              </div>
              <div className="info-cell">
                <div className="info-cell-label">Arrival</div>
                <div className="info-cell-value">{formatTime(flight.arrivalActual ?? flight.arrivalEstimated ?? flight.arrivalScheduled)}</div>
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

            {flight.events && flight.events.length > 0 && (
              <div style={{ marginTop: '1rem' }}>
                <h3 style={{ fontSize: '0.9rem', marginBottom: '0.75rem', color: 'var(--text-muted)' }}>Recent Updates</h3>
                {flight.events.slice(0, 5).map(ev => (
                  <div key={ev.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem 0', borderBottom: '1px solid var(--border)', fontSize: '0.875rem' }}>
                    <span style={{ textTransform: 'capitalize' }}>{ev.eventType.replace(/_/g, ' ')}</span>
                    <span style={{ color: 'var(--text-muted)' }}>{formatDateTime(ev.occurredAt)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <p style={{ textAlign: 'center', marginTop: '1.5rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
          Powered by <a href="https://github.com" style={{ color: 'var(--accent)' }}>Departarr</a> · Updates every 30s
        </p>
      </div>
    </div>
  )
}
