import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api, type Flight } from '../lib/api'
import { FlightCard } from '../components/FlightCard'
import { formatDate } from '../lib/format'

function groupByTrip(flights: Flight[]): Map<string, { name: string; flights: Flight[] }> {
  const groups = new Map<string, { name: string; flights: Flight[] }>()
  for (const f of flights) {
    const key = f.tripId ?? '__none__'
    const name = f.trip?.name ?? 'No Trip'
    if (!groups.has(key)) groups.set(key, { name, flights: [] })
    groups.get(key)!.flights.push(f)
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

  const groups = flights ? groupByTrip(flights) : new Map()

  return (
    <>
      <div className="page-header">
        <h1>Upcoming</h1>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <Link to="/flights/add"><button className="secondary">+ Flight</button></Link>
        </div>
      </div>

      {isLoading && <div className="loading">Loading…</div>}

      {flights && flights.length === 0 && (
        <div className="empty">
          <h3>No upcoming flights</h3>
          <p>Add a flight to start tracking</p>
        </div>
      )}

      {trips && trips.length > 0 && (
        <div style={{ marginBottom: '1.5rem' }}>
          <h2 style={{ fontSize: '1rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>Trips</h2>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            {trips.map(t => (
              <Link key={t.id} to={`/trips/${t.id}`}>
                <div className="card" style={{ padding: '0.75rem 1rem', display: 'inline-block' }}>
                  <div style={{ fontWeight: 600 }}>{t.name}</div>
                  {t.startDate && <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{formatDate(t.startDate)}</div>}
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {([...groups.entries()] as [string, { name: string; flights: Flight[] }][]).map(([key, { name, flights: groupFlights }]) => (
        <div key={key} style={{ marginBottom: '1.5rem' }}>
          {key !== '__none__' && (
            <h2 style={{ fontSize: '1rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>{name}</h2>
          )}
          {groupFlights.map((f) => <FlightCard key={f.id} flight={f} showDate />)}
        </div>
      ))}
    </>
  )
}
