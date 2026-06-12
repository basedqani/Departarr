import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'
import { FlightCard } from '../components/FlightCard'

export function PastPage(): React.ReactElement {
  const { data: flights, isLoading } = useQuery({
    queryKey: ['flights', 'past'],
    queryFn: () => api.flights.list('past'),
  })

  return (
    <>
      <div className="page-header">
        <h1>Past Flights</h1>
      </div>

      {isLoading && <div className="loading">Loading…</div>}

      {flights && flights.length === 0 && (
        <div className="empty">
          <h3>No past flights</h3>
          <p>Your flight history will appear here</p>
        </div>
      )}

      {flights?.map(f => (
        <FlightCard key={f.id} flight={f} showDate />
      ))}
    </>
  )
}
