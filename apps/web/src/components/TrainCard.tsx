import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import type { Train } from '../lib/api'
import { StatusBadge } from './StatusBadge'
import { formatDate } from '../lib/format'

interface Props {
  train: Train
  showDate?: boolean
  index?: number
}

// NOTE: Amtrak stations don't have a standardised timezone map equivalent to
// getAirportTz(). For v1 we display times in the browser's local timezone.
// A proper station→timezone map should be added in a future iteration.
function formatLocalTimeBrowser(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function delayMinutes(scheduled: string | null | undefined, updated: string | null | undefined): number {
  if (!scheduled || !updated) return 0
  const diff = Math.round((new Date(updated).getTime() - new Date(scheduled).getTime()) / 60_000)
  return Math.abs(diff) > 5 ? diff : 0
}

function TrainIcon(): React.ReactElement {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      <rect x="4" y="3" width="16" height="13" rx="2" />
      <path d="M4 11h16" />
      <path d="M12 3v8" />
      <path d="M8 19l-2 3" />
      <path d="M18 22l-2-3" />
      <path d="M7 19h10" />
    </svg>
  )
}

function RouteArrow(): React.ReactElement {
  return (
    <span className="flight-route-line">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="5" y1="12" x2="19" y2="12" />
        <polyline points="12 5 19 12 12 19" />
      </svg>
    </span>
  )
}

export function TrainCard({ train, showDate, index = 0 }: Props): React.ReactElement {
  const depTime = formatLocalTimeBrowser(
    train.departureActual ?? train.departureEstimated ?? train.departureScheduled
  )
  const arrTime = formatLocalTimeBrowser(
    train.arrivalActual ?? train.arrivalEstimated ?? train.arrivalScheduled
  )
  const depDelay = delayMinutes(train.departureScheduled, train.departureActual ?? train.departureEstimated)
  const arrDelay = delayMinutes(train.arrivalScheduled, train.arrivalActual ?? train.arrivalEstimated)

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, delay: index * 0.05, ease: [0.25, 0.46, 0.45, 0.94] }}
      whileTap={{ scale: 0.985 }}
    >
      <Link to={`/trains/${train.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
        <div className="card card-hover flight-card tear-stub">

          {/* Row 1: Route + Status badge */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem' }}>
            <div className="flight-route">
              <span>{train.origin}</span>
              <RouteArrow />
              <span>{train.destination}</span>
            </div>
            <StatusBadge status={train.status} />
          </div>

          {/* Row 2: Train icon + number + name */}
          <div className="flight-meta-row" style={{ marginTop: '0.3rem' }}>
            <TrainIcon />
            <span className="flight-meta-ident">{train.trainNumber}</span>
            {train.trainName && (
              <>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>·</span>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{train.trainName}</span>
              </>
            )}
            {showDate && (
              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{formatDate(train.departureScheduled)}</span>
            )}
          </div>

          {/* Perforation divider */}
          <div className="flight-perforation" />

          {/* Row 3: Departs / Arrives / Status — boarding pass 3-col grid */}
          <div className="flight-board-row">
            <div className="flight-board-cell">
              <span className="pass-label">Departs</span>
              <span className="pass-value" style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', flexWrap: 'wrap' }}>
                <span>{depTime}</span>
                {depDelay !== 0 && (
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
                    {depDelay > 0 ? `+${depDelay}m` : `${depDelay}m`}
                  </span>
                )}
              </span>
            </div>
            <div className="flight-board-cell">
              <span className="pass-label">Arrives</span>
              <span className="pass-value" style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', flexWrap: 'wrap' }}>
                <span>{arrTime}</span>
                {arrDelay !== 0 && (
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
                    {arrDelay > 0 ? `+${arrDelay}m` : `${arrDelay}m`}
                  </span>
                )}
              </span>
            </div>
            <div className="flight-board-cell" style={{ alignItems: 'flex-end' }}>
              {train.seat && (
                <>
                  <span className="pass-label" style={{ textAlign: 'right', width: '100%' }}>Seat</span>
                  <span className="pass-value">{train.seat}</span>
                </>
              )}
            </div>
          </div>

          {train.trip && (
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '0.3rem', marginTop: '0.25rem' }}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
              </svg>
              {train.trip.name}
            </div>
          )}
        </div>
      </Link>
    </motion.div>
  )
}
