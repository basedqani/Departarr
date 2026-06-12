import { useQuery } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import { api } from '../lib/api'
import { FlightCard } from '../components/FlightCard'

function getGreeting(): string {
  const h = new Date().getHours()
  if (h < 5) return 'Good night'
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

function EmptyState(): React.ReactElement {
  return (
    <div className="empty">
      <svg width="64" height="64" viewBox="0 0 64 64" fill="none" style={{ margin: '0 auto 1rem', display: 'block', opacity: 0.35 }}>
        <circle cx="32" cy="32" r="30" stroke="var(--text-muted)" strokeWidth="2" />
        <path d="M44 38v-4l-16-10V12c0-1.66-1.34-3-3-3s-3 1.34-3 3v12L6 34v4l16-5v10l-4 3v3l7-2 7 2v-3l-4-3V33l16 5z" fill="var(--text-muted)" />
      </svg>
      <h3>No flights today</h3>
      <p>Your flights for today will appear here</p>
    </div>
  )
}

export function TodayPage(): React.ReactElement {
  const { data: flights, isLoading } = useQuery({
    queryKey: ['flights', 'today'],
    queryFn: () => api.flights.list('today'),
    refetchInterval: 60_000,
  })

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2 }}
    >
      <div style={{ paddingTop: '0.75rem', marginBottom: '0.25rem' }}>
        <div className="greeting">{getGreeting()}</div>
        <div className="greeting-sub">
          {flights && flights.length > 0
            ? `You have ${flights.length} flight${flights.length > 1 ? 's' : ''} today`
            : 'No flights scheduled for today'
          }
        </div>
      </div>

      {isLoading && (
        <div className="loading">
          <div className="loading-spinner" />
          Loading flights…
        </div>
      )}

      <AnimatePresence>
        {flights && flights.length === 0 && !isLoading && (
          <EmptyState />
        )}
      </AnimatePresence>

      {flights?.map((f, i) => (
        <FlightCard key={f.id} flight={f} index={i} />
      ))}
    </motion.div>
  )
}
