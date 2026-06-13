import { useQuery } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import { Link } from 'react-router-dom'
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
    <motion.div
      className="empty"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <motion.svg
        width="72" height="72" viewBox="0 0 64 64" fill="none"
        style={{ margin: '0 auto 1.25rem', display: 'block' }}
        initial={{ rotate: -8 }} animate={{ rotate: 0 }} transition={{ type: 'spring', stiffness: 120, damping: 12 }}
      >
        <circle cx="32" cy="32" r="30" stroke="var(--accent)" strokeWidth="2" opacity="0.25" />
        <path d="M44 38v-4l-16-10V12c0-1.66-1.34-3-3-3s-3 1.34-3 3v12L6 34v4l16-5v10l-4 3v3l7-2 7 2v-3l-4-3V33l16 5z" fill="var(--accent)" opacity="0.85" />
      </motion.svg>
      <h3>No flights today</h3>
      <p style={{ maxWidth: 320, margin: '0.25rem auto 1.5rem' }}>
        Add a flight to see live tracking, a beautiful globe, gate info and countdowns.
      </p>
      <Link to="/flights/add">
        <button style={{ padding: '0.7rem 1.5rem', fontSize: '0.9rem', fontWeight: 600 }}>
          Add a flight
        </button>
      </Link>
      <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '1rem', opacity: 0.8 }}>
        Try <span style={{ fontFamily: 'monospace', color: 'var(--accent)', fontWeight: 600 }}>BA178</span> or <span style={{ fontFamily: 'monospace', color: 'var(--accent)', fontWeight: 600 }}>NH7</span> to explore
      </p>
    </motion.div>
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
