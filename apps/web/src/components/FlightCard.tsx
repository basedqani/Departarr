import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import type { Flight } from '../lib/api'
import { StatusBadge } from './StatusBadge'
import { formatTime, formatDate } from '../lib/format'

interface Props {
  flight: Flight
  showDate?: boolean
  index?: number
}

function PlaneGlyph(): React.ReactElement {
  return (
    <span className="flight-route-glyph">
      <svg viewBox="0 0 24 24" fill="currentColor">
        <path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z" />
      </svg>
    </span>
  )
}

function flightProgress(flight: Flight): number | null {
  const st = flight.status.toLowerCase().replace(/[\s_]+/g, '-')
  if (st !== 'en-route' && st !== 'departed') return null
  const dep = new Date(flight.departureActual ?? flight.departureScheduled).getTime()
  const arr = new Date(flight.arrivalEstimated ?? flight.arrivalScheduled).getTime()
  const now = Date.now()
  if (dep >= arr) return null
  return Math.max(0, Math.min(100, ((now - dep) / (arr - dep)) * 100))
}

export function FlightCard({ flight, showDate, index = 0 }: Props): React.ReactElement {
  const depTime = flight.departureActual ?? flight.departureEstimated ?? flight.departureScheduled
  const arrTime = flight.arrivalActual ?? flight.arrivalEstimated ?? flight.arrivalScheduled
  const progress = flightProgress(flight)

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: index * 0.05, ease: [0.25, 0.46, 0.45, 0.94] }}
      whileTap={{ scale: 0.98 }}
    >
      <Link to={`/flights/${flight.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
        <div className="card card-hover flight-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div className="flight-route">
              <span>{flight.origin}</span>
              <PlaneGlyph />
              <span>{flight.destination}</span>
            </div>
            <StatusBadge status={flight.status} />
          </div>

          <div className="flight-meta">
            <span style={{ fontWeight: 600, color: 'var(--text-dim)' }}>{flight.ident}</span>
            {showDate && <span>{formatDate(flight.departureScheduled)}</span>}
            <span className="flight-meta-times">
              {formatTime(depTime)} → {formatTime(arrTime)}
            </span>
            {flight.gateDeparture && <span>Gate {flight.gateDeparture}</span>}
            {flight.terminalDeparture && <span>T{flight.terminalDeparture}</span>}
            {flight.aircraftType && <span>{flight.aircraftType}</span>}
          </div>

          {progress !== null && (
            <div className="flight-progress">
              <div className="flight-progress-fill" style={{ width: `${progress}%` }} />
            </div>
          )}

          {flight.trip && (
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
              </svg>
              {flight.trip.name}
            </div>
          )}
        </div>
      </Link>
    </motion.div>
  )
}
