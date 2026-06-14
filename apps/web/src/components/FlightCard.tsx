import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import type { Flight } from '../lib/api'
import { StatusBadge } from './StatusBadge'
import { formatTime, formatDate } from '../lib/format'
import { getAirline } from '../lib/airlines'
import { useCountdown } from '../hooks/useCountdown'

interface Props {
  flight: Flight
  showDate?: boolean
  index?: number
}

// Brand colors for major carriers, keyed by 2-letter IATA prefix.
const AIRLINE_COLORS: Record<string, string> = {
  DL: '#003366', AA: '#0078D2', UA: '#005daa', BA: '#075aaa',
  LH: '#05164d', AF: '#002157', NH: '#13448f', EK: '#d71921',
  QF: '#e0001b', AC: '#d22630', KL: '#00a1de', IB: '#d40f14',
  SQ: '#f99f1c', CX: '#006564', VS: '#e10a0a',
}

function airlineColor(flight: Flight): string {
  const prefix = (flight.airlineIata ?? flight.ident).slice(0, 2).toUpperCase()
  return AIRLINE_COLORS[prefix] ?? 'var(--accent)'
}

function RouteLine(): React.ReactElement {
  return (
    <span className="flight-route-line">
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

function countdownColor(flight: Flight): string {
  const st = flight.status.toLowerCase().replace(/[\s_]+/g, '-')
  if (st === 'cancelled' || st === 'arrived' || st === 'landed') return 'var(--muted-status)'
  const depTime = new Date(flight.departureActual ?? flight.departureEstimated ?? flight.departureScheduled).getTime()
  const diff = depTime - Date.now()
  const hasDeparted = !!flight.departureActual || st === 'en-route' || st === 'departed'
  if (!hasDeparted && diff < 30 * 60 * 1000) return 'var(--delayed)'
  return 'var(--accent)'
}

function countdownBg(flight: Flight): string {
  const st = flight.status.toLowerCase().replace(/[\s_]+/g, '-')
  if (st === 'cancelled' || st === 'arrived' || st === 'landed') return 'rgba(148,163,184,0.12)'
  const depTime = new Date(flight.departureActual ?? flight.departureEstimated ?? flight.departureScheduled).getTime()
  const diff = depTime - Date.now()
  const hasDeparted = !!flight.departureActual || st === 'en-route' || st === 'departed'
  if (!hasDeparted && diff < 30 * 60 * 1000) return 'rgba(251,191,36,0.12)'
  return 'var(--accent-dim)'
}

function CountdownChip({ flight }: { flight: Flight }): React.ReactElement {
  const text = useCountdown(flight)
  return (
    <span style={{
      fontSize: '0.68rem',
      fontWeight: 600,
      padding: '0.15rem 0.55rem',
      borderRadius: 99,
      background: countdownBg(flight),
      color: countdownColor(flight),
      letterSpacing: '0.03em',
      fontVariantNumeric: 'tabular-nums',
      whiteSpace: 'nowrap',
      flexShrink: 0,
    }}>
      {text}
    </span>
  )
}

export function FlightCard({ flight, showDate, index = 0 }: Props): React.ReactElement {
  const depTime = flight.departureActual ?? flight.departureEstimated ?? flight.departureScheduled
  const arrTime = flight.arrivalActual ?? flight.arrivalEstimated ?? flight.arrivalScheduled
  const progress = flightProgress(flight)
  const color = airlineColor(flight)
  const airlineName = getAirline(flight.airlineIata ?? flight.ident.slice(0, 2))?.name

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: index * 0.05, ease: [0.25, 0.46, 0.45, 0.94] }}
      whileTap={{ scale: 0.98 }}
    >
      <Link to={`/flights/${flight.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
        <div className="card card-hover flight-card" style={{ '--airline-color': color } as React.CSSProperties}>
          {/* Top row: route + countdown */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.75rem' }}>
            <div className="flight-route">
              <span>{flight.origin}</span>
              <RouteLine />
              <span>{flight.destination}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.35rem', flexShrink: 0 }}>
              <StatusBadge status={flight.status} />
              <CountdownChip flight={flight} />
            </div>
          </div>

          <div className="flight-perforation" />

          {/* Meta row */}
          <div className="flight-meta-row">
            <span className="flight-meta-ident">{flight.ident}</span>
            {airlineName && (
              <span className="flight-meta-chip flight-meta-chip-dim">{airlineName}</span>
            )}
            {showDate && (
              <span className="flight-meta-chip">{formatDate(flight.departureScheduled)}</span>
            )}
            <span className="flight-meta-times">{formatTime(depTime)} → {formatTime(arrTime)}</span>
            {flight.gateDeparture && (
              <span className="flight-meta-chip">
                <span className="flight-meta-chip-label">Gate</span>
                {flight.gateDeparture}
              </span>
            )}
            {flight.terminalDeparture && (
              <span className="flight-meta-chip">
                <span className="flight-meta-chip-label">T</span>
                {flight.terminalDeparture}
              </span>
            )}
            {flight.aircraftType && (
              <span className="flight-meta-chip flight-meta-chip-dim">{flight.aircraftType}</span>
            )}
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
