import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { api } from '../lib/api'
import { FlightCard } from '../components/FlightCard'
import { ConnectionBadge } from '../components/ConnectionBadge'
import { TripCard } from '../components/TripCard'
import { buildDisplayItems } from '../lib/tripGrouping'
import { formatDate } from '../lib/format'

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

function getItemDateKey(item: ReturnType<typeof buildDisplayItems>[number]): string {
  if (item.type === 'trip') {
    return item.legs[0].departureScheduled.substring(0, 10)
  }
  return item.flight.departureScheduled.substring(0, 10)
}

function getItemFirstDeparture(item: ReturnType<typeof buildDisplayItems>[number]): string {
  if (item.type === 'trip') return item.legs[0].departureScheduled
  return item.flight.departureScheduled
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

  const displayItems = buildDisplayItems(flights ?? [])

  // Group display items by date
  const dateGroups = new Map<string, ReturnType<typeof buildDisplayItems>>()
  for (const item of displayItems) {
    const key = getItemDateKey(item)
    if (!dateGroups.has(key)) dateGroups.set(key, [])
    dateGroups.get(key)!.push(item)
  }

  let globalIndex = 0

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

      {([...dateGroups.entries()] as [string, ReturnType<typeof buildDisplayItems>][]).map(
        ([dateKey, items]) => {
          const firstDeparture = getItemFirstDeparture(items[0])
          return (
            <div key={dateKey} style={{ marginBottom: '0.5rem' }}>
              <div className="date-group-header">
                {formatDate(dateKey)}
                <span className="countdown-chip">{countdownLabel(firstDeparture)}</span>
              </div>
              {items.map(item => {
                if (item.type === 'trip') {
                  const idx = globalIndex
                  globalIndex += item.legs.length
                  return <TripCard key={item.tripId} group={item} index={idx} />
                }
                const f = item.flight
                const conn = connections?.find(c => c.flightId === f.id)
                const idx = globalIndex++
                return (
                  <div key={f.id}>
                    <FlightCard flight={f} index={idx} />
                    {conn && conn.risk !== 'green' && <ConnectionBadge conn={conn} />}
                  </div>
                )
              })}
            </div>
          )
        }
      )}
    </motion.div>
  )
}
