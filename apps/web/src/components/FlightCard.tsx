import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import type { Flight } from '../lib/api'
import { StatusBadge } from './StatusBadge'
import { AirlineLogo } from './AirlineLogo'
import { formatDate, getAirportTz, formatLocalTime, formatDelay } from '../lib/format'
import { getAirline } from '../lib/airlines'
import { useCountdown } from '../hooks/useCountdown'

interface Props {
  flight: Flight
  showDate?: boolean
  index?: number
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

/** Returns delay in minutes (positive = late) or 0 if no meaningful change. */
function delayMinutes(scheduled: string | null | undefined, updated: string | null | undefined): number {
  if (!scheduled || !updated) return 0
  const diff = Math.round((new Date(updated).getTime() - new Date(scheduled).getTime()) / 60_000)
  return Math.abs(diff) > 5 ? diff : 0
}

interface TimeWithDelayProps {
  scheduled: string | null | undefined
  estimated: string | null | undefined
  actual: string | null | undefined
  airportIata: string
  align?: 'left' | 'right'
}

function TimeWithDelay({ scheduled, estimated, actual, airportIata, align = 'left' }: TimeWithDelayProps): React.ReactElement {
  const best = actual ?? estimated ?? scheduled
  const tz = getAirportTz(airportIata)
  const displayTime = formatLocalTime(best, tz)
  const delay = delayMinutes(scheduled, actual ?? estimated)

  const badge = delay !== 0 ? (
    <span style={{
      fontSize: '0.62rem',
      fontWeight: 700,
      padding: '0.08rem 0.35rem',
      borderRadius: 3,
      background: 'rgba(251,191,36,0.15)',
      border: '1px solid rgba(251,191,36,0.4)',
      color: '#fbbf24',
      letterSpacing: '0.02em',
      whiteSpace: 'nowrap',
    }}>
      {formatDelay(delay)}
    </span>
  ) : null

  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', flexWrap: 'wrap', justifyContent: align === 'right' ? 'flex-end' : 'flex-start' }}>
      {align === 'right' ? (
        <>
          {badge}
          <span>{displayTime}</span>
        </>
      ) : (
        <>
          <span>{displayTime}</span>
          {badge}
        </>
      )}
    </span>
  )
}

function flightProgress(flight: Flight): number | null {
  const st = flight.status.toLowerCase().replace(/[\s_]+/g, '-')
  if (st !== 'en-route' && st !== 'departed') return null
  const dep = new Date(flight.departureActual ?? flight.departureScheduled).getTime()
  const arr = new Date(flight.arrivalEstimated ?? flight.arrivalScheduled).getTime()
  const now = Date.now()
  // Don't show progress bar if departure time hasn't passed yet
  if (dep > now) return null
  if (dep >= arr) return null
  return Math.max(0, Math.min(100, ((now - dep) / (arr - dep)) * 100))
}

function countdownColor(flight: Flight): string {
  const st = flight.status.toLowerCase().replace(/[\s_]+/g, '-')
  if (st === 'cancelled' || st === 'arrived' || st === 'landed') return 'var(--muted-status)'
  const depTime = new Date(flight.departureActual ?? flight.departureEstimated ?? flight.departureScheduled).getTime()
  const diff = depTime - Date.now()
  const hasDeparted = !!flight.departureActual || depTime <= Date.now()
  if (!hasDeparted && diff < 30 * 60 * 1000) return 'var(--cancelled)'
  return 'var(--accent)'
}

function CountdownChip({ flight }: { flight: Flight }): React.ReactElement {
  const text = useCountdown(flight, getAirportTz(flight.origin))
  return (
    <span style={{
      fontSize: '0.68rem',
      fontWeight: 600,
      padding: '0.12rem 0.5rem',
      borderRadius: 3,
      background: 'var(--surface-raised)',
      border: '1px solid var(--hairline)',
      color: countdownColor(flight),
      letterSpacing: '0.03em',
      fontVariantNumeric: 'tabular-nums',
      fontFamily: 'var(--font-mono)',
      whiteSpace: 'nowrap',
      flexShrink: 0,
    }}>
      {text}
    </span>
  )
}

export function FlightCard({ flight, showDate, index = 0 }: Props): React.ReactElement {
  const progress = flightProgress(flight)
  const airlineName = getAirline(flight.airlineIata ?? flight.ident.slice(0, 2))?.name

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, delay: index * 0.05, ease: [0.25, 0.46, 0.45, 0.94] }}
      whileTap={{ scale: 0.985 }}
    >
      <Link to={`/flights/${flight.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
        <div className="card card-hover flight-card tear-stub">

          {/* Row 1: Route + Status badge */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem' }}>
            <div className="flight-route">
              <span>{flight.origin}</span>
              <RouteLine />
              <span>{flight.destination}</span>
            </div>
            <StatusBadge status={flight.status} />
          </div>

          {/* Row 2: Airline logo + flight code + name */}
          <div className="flight-meta-row" style={{ marginTop: '0.3rem' }}>
            <AirlineLogo iata={flight.airlineIata} size={18} style={{ borderRadius: 2 }} />
            <span className="flight-meta-ident">{flight.ident}</span>
            {airlineName && (
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>·</span>
            )}
            {airlineName && (
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{airlineName}</span>
            )}
            {showDate && (
              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{formatDate(flight.departureScheduled)}</span>
            )}
          </div>

          {/* Perforation divider */}
          <div className="flight-perforation" />

          {/* Row 3: Seat / Gate / Boards — boarding pass 3-col grid */}
          <div className="flight-board-row">
            <div className="flight-board-cell">
              <span className="pass-label">Boards</span>
              <span className="pass-value">
                <TimeWithDelay
                  scheduled={flight.departureScheduled}
                  estimated={flight.departureEstimated}
                  actual={flight.departureActual}
                  airportIata={flight.origin}
                />
              </span>
            </div>
            {flight.gateDeparture ? (
              <div className="flight-board-cell">
                <span className="pass-label">Gate</span>
                <span className="pass-value">{flight.gateDeparture}</span>
              </div>
            ) : flight.terminalDeparture ? (
              <div className="flight-board-cell">
                <span className="pass-label">Terminal</span>
                <span className="pass-value">{flight.terminalDeparture}</span>
              </div>
            ) : (
              <div className="flight-board-cell">
                <span className="pass-label">Arrives</span>
                <span className="pass-value">
                  <TimeWithDelay
                    scheduled={flight.arrivalScheduled}
                    estimated={flight.arrivalEstimated}
                    actual={flight.arrivalActual}
                    airportIata={flight.destination}
                    align="right"
                  />
                </span>
              </div>
            )}
            <div className="flight-board-cell" style={{ alignItems: 'flex-end' }}>
              <span className="pass-label" style={{ textAlign: 'right', width: '100%' }}>Status</span>
              <CountdownChip flight={flight} />
            </div>
          </div>

          {/* In-flight progress bar */}
          {progress !== null && (
            <div className="flight-progress">
              <div className="flight-progress-fill" style={{ width: `${progress}%` }} />
            </div>
          )}

          {flight.trip && (
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '0.3rem', marginTop: '0.25rem' }}>
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
