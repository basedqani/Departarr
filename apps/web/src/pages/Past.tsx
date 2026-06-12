import { useQuery } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { api, type Flight } from '../lib/api'
import { FlightCard } from '../components/FlightCard'
import { formatDate } from '../lib/format'

function groupByMonth(flights: Flight[]): Map<string, Flight[]> {
  const groups = new Map<string, Flight[]>()
  for (const f of flights) {
    const d = new Date(f.departureScheduled)
    const key = d.toLocaleDateString([], { year: 'numeric', month: 'long' })
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(f)
  }
  return groups
}

export function PastPage(): React.ReactElement {
  const { data: flights, isLoading } = useQuery({
    queryKey: ['flights', 'past'],
    queryFn: () => api.flights.list('past'),
  })

  const groups = flights ? groupByMonth(flights) : new Map<string, Flight[]>()

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2 }}
    >
      <div className="page-header">
        <h1>Past Flights</h1>
      </div>

      {isLoading && (
        <div className="loading">
          <div className="loading-spinner" />
          Loading…
        </div>
      )}

      {flights && flights.length === 0 && !isLoading && (
        <div className="empty">
          <h3>No past flights</h3>
          <p>Your flight history will appear here</p>
        </div>
      )}

      {([...groups.entries()] as [string, Flight[]][]).map(([month, groupFlights], groupIdx) => (
        <div key={month} style={{ marginBottom: '0.5rem' }}>
          <div className="date-group-header">{month}</div>
          {groupFlights.map((f, i) => (
            <FlightCard
              key={f.id}
              flight={f}
              showDate
              index={groupIdx * 10 + i}
            />
          ))}
        </div>
      ))}
    </motion.div>
  )
}

// re-export formatDate used internally to silence unused import warning
export { formatDate }
