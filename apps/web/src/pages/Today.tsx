import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import { FlightCard } from '../components/FlightCard'
import { timeAgo } from '../lib/format'

export function TodayPage(): React.ReactElement {
  const { data: flights, isLoading, dataUpdatedAt } = useQuery({
    queryKey: ['flights', 'today'],
    queryFn: () => api.flights.list('today'),
    refetchInterval: 60_000,
  })

  return (
    <>
      <div className="page-header">
        <h1>Today</h1>
        <Link to="/flights/add">
          <button>+ Add flight</button>
        </Link>
      </div>

      {dataUpdatedAt > 0 && (
        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
          Updated {timeAgo(new Date(dataUpdatedAt).toISOString())}
        </p>
      )}

      {isLoading && <div className="loading">Loading flights…</div>}

      {flights && flights.length === 0 && (
        <div className="empty">
          <h3>No flights today</h3>
          <p>Add a flight to start tracking</p>
        </div>
      )}

      {flights?.map(f => (
        <FlightCard key={f.id} flight={f} />
      ))}
    </>
  )
}
