import { useQuery } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import { FlightCard } from '../components/FlightCard'
import { TrainCard } from '../components/TrainCard'
import { ConnectionBadge } from '../components/ConnectionBadge'
import { InlineConnectionBadge } from '../components/InlineConnectionBadge'
import { TripCard } from '../components/TripCard'
import { buildDisplayItems } from '../lib/tripGrouping'

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
        width="72" height="72" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg"
        style={{ margin: '0 auto 1.25rem', display: 'block', color: 'var(--text-muted)' }}
        initial={{ rotate: -8 }} animate={{ rotate: 0 }} transition={{ type: 'spring', stiffness: 120, damping: 12 }}
      >
        <rect x="1.5" y="6" width="29" height="20" rx="2.5" stroke="currentColor" strokeWidth="2" fill="none" />
        <circle cx="1.5" cy="13" r="2.5" fill="var(--bg)" stroke="currentColor" strokeWidth="1.5" />
        <circle cx="1.5" cy="19" r="2.5" fill="var(--bg)" stroke="currentColor" strokeWidth="1.5" />
        <line x1="8" y1="8" x2="8" y2="24" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2 2.5" strokeLinecap="round" />
        <rect x="2" y="6.5" width="6" height="19" fill="currentColor" opacity="0.12" rx="1.5" />
        <circle cx="14" cy="16" r="1.5" fill="currentColor" />
        <line x1="16" y1="16" x2="22" y2="16" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2 2" strokeLinecap="round" />
        <path d="M24 14.5 L26.5 16 L24 17.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
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

  const { data: trains = [] } = useQuery({
    queryKey: ['trains', 'today'],
    queryFn: () => api.trains.list('today'),
    refetchInterval: 60_000,
  })

  const { data: connections } = useQuery({
    queryKey: ['connections'],
    queryFn: api.flights.connections,
    refetchInterval: 60_000,
  })

  const displayItems = buildDisplayItems(flights ?? [], trains)

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2 }}
    >
      <div style={{ paddingTop: '0.75rem', marginBottom: '0.25rem' }}>
        <div className="greeting">{getGreeting()}</div>
        <div className="greeting-sub">
          {(() => {
            // GEN-5: count flights AND trains so the header isn't "0 flights"
            // when the user only has trains scheduled today.
            const total = (flights?.length ?? 0) + trains.length
            return total > 0
              ? `You have ${total} trip${total > 1 ? 's' : ''} today`
              : 'Nothing scheduled for today'
          })()}
        </div>
      </div>

      {isLoading && (
        <div className="loading">
          <div className="loading-spinner" />
          Loading flights…
        </div>
      )}

      <AnimatePresence>
        {flights && flights.length === 0 && trains.length === 0 && !isLoading && (
          <EmptyState />
        )}
      </AnimatePresence>

      {displayItems.map((item, i) => {
        if (item.type === 'trip') {
          return <TripCard key={item.tripId} group={item} index={i} />
        }
        if (item.type === 'auto-itinerary') {
          const legIds = item.legs.map(l => l.data.id).join('-')
          return (
            <div key={legIds} style={{ borderLeft: '2px solid var(--accent)', paddingLeft: '0.1rem', marginBottom: '0.5rem', opacity: 0.97 }}>
              {item.legs.map((leg, li) => (
                <div key={leg.data.id}>
                  {leg.legType === 'flight'
                    ? <FlightCard flight={leg.data} index={i + li} />
                    : <TrainCard train={leg.data} index={i + li} />}
                  {li < item.legs.length - 1 && item.connections[li] && (
                    <InlineConnectionBadge conn={item.connections[li]!} showGreen />
                  )}
                </div>
              ))}
            </div>
          )
        }
        if (item.type === 'standalone-train') {
          return <TrainCard key={item.train.id} train={item.train} index={i} />
        }
        const f = item.flight
        const conn = connections?.find(c => c.flightId === f.id)
        return (
          <div key={f.id}>
            <FlightCard flight={f} index={i} />
            {conn && conn.risk !== 'green' && <ConnectionBadge conn={conn} />}
          </div>
        )
      })}
    </motion.div>
  )
}
