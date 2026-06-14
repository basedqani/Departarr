import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { api, type Flight, type ConnectionResult } from '../lib/api'
import { FlightCard } from '../components/FlightCard'
import { formatDate } from '../lib/format'

function ConnectionBadge({ conn }: { conn: ConnectionResult }): React.ReactElement {
  const color = conn.risk === 'red' ? '#e53e3e' : '#d69e2e'
  const icon = conn.risk === 'red' ? '⚠️' : '⏱'
  const mins = conn.minutesAvailable
  return (
    <div
      className="connection-badge"
      style={
        {
          '--badge-color': color,
          background: conn.risk === 'red' ? 'rgba(229,62,62,0.12)' : 'rgba(214,158,46,0.12)',
          border: `1px solid ${conn.risk === 'red' ? 'rgba(229,62,62,0.35)' : 'rgba(214,158,46,0.35)'}`,
        } as React.CSSProperties
      }
    >
      {icon} {mins}m connection at {conn.airport}
      {conn.risk === 'red' ? ' — AT RISK' : ' — Tight'}
    </div>
  )
}

function daysUntil(dateStr: string): number {
  const dep = new Date(dateStr)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  dep.setHours(0, 0, 0, 0)
  return Math.round((dep.getTime() - today.getTime()) / 86_400_000)
}

function countdownLabel(dateStr: string): string {
  const d = daysUntil(dateStr)
  if (d === 0) return 'Today'
  if (d === 1) return 'Tomorrow'
  if (d > 0) return `in ${d} days`
  return 'Past'
}

function groupByDate(flights: Flight[]): Map<string, Flight[]> {
  const groups = new Map<string, Flight[]>()
  for (const f of flights) {
    const key = f.departureScheduled.substring(0, 10)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(f)
  }
  return groups
}

export function UpcomingPage(): React.ReactElement {
  const { data: flights, isLoading } = useQuery({
    queryKey: ['flights', 'upcoming'],
    queryFn: () => api.flights.list('upcoming'),
    refetchInterval: 120_000,
  })

  const { data: trips } = useQuery({
    queryKey: ['trips'],
    queryFn: api.trips.list,
  })

  const { data: connections } = useQuery({
    queryKey: ['connections'],
    queryFn: api.flights.connections,
    refetchInterval: 60_000,
  })

  const groups = flights ? groupByDate(flights) : new Map<string, Flight[]>()

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2 }}
    >
      <div className="page-header">
        <h1>Upcoming</h1>
      </div>

      {isLoading && (
        <div className="loading">
          <div className="loading-spinner" />
          Loading…
        </div>
      )}

      {trips && trips.length > 0 && (
        <div style={{ marginBottom: '1.5rem' }}>
          <div className="section-label">Trips</div>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            {trips.map(t => (
              <Link key={t.id} to={`/trips/${t.id}`} className="trip-chip">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17 8h1a4 4 0 0 1 0 8h-1" />
                  <path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V8z" />
                  <line x1="6" y1="2" x2="6" y2="4" />
                  <line x1="10" y1="2" x2="10" y2="4" />
                  <line x1="14" y1="2" x2="14" y2="4" />
                </svg>
                {t.name}
                {t.startDate && (
                  <span style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: '0.78rem' }}>
                    {formatDate(t.startDate)}
                  </span>
                )}
              </Link>
            ))}
          </div>
        </div>
      )}

      {flights && flights.length === 0 && !isLoading && (
        <div className="empty">
          <h3>No upcoming flights</h3>
          <p>Add a flight to start tracking</p>
        </div>
      )}

      {([...groups.entries()] as [string, Flight[]][]).map(([dateKey, groupFlights], groupIdx) => (
        <div key={dateKey} style={{ marginBottom: '0.5rem' }}>
          <div className="date-group-header">
            {formatDate(dateKey)}
            <span className="countdown-chip">{countdownLabel(groupFlights[0].departureScheduled)}</span>
          </div>
          {groupFlights.map((f, i) => {
            const conn = connections?.find(c => c.flightId === f.id)
            return (
              <div key={f.id}>
                <FlightCard flight={f} index={groupIdx * 10 + i} />
                {conn && conn.risk !== 'green' && <ConnectionBadge conn={conn} />}
              </div>
            )
          })}
        </div>
      ))}
    </motion.div>
  )
}
