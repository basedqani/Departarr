import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import type { TripGroupItem } from '../lib/tripGrouping'
import { StatusBadge } from './StatusBadge'
import { AirlineLogo } from './AirlineLogo'
import { formatLocalTime, formatDate, getAirportTz } from '../lib/format'

/** Returns the "worst" status across all legs of a trip.
 *  Priority: cancelled > delayed > en-route > boarding > scheduled/on-time */
function worstStatus(statuses: string[]): string {
  const rank = (s: string): number => {
    const st = s.toLowerCase().replace(/[\s_]+/g, '-')
    if (st === 'cancelled') return 5
    if (st === 'delayed') return 4
    if (st === 'en-route' || st === 'departed') return 3
    if (st === 'boarding') return 2
    if (st === 'arrived' || st === 'landed') return 1
    return 0
  }
  return statuses.reduce((best, cur) => rank(cur) > rank(best) ? cur : best, statuses[0] ?? 'Scheduled')
}

interface Props {
  group: TripGroupItem
  index?: number
}

export function TripCard({ group, index = 0 }: Props): React.ReactElement {
  const { legs, tripId } = group
  const firstLeg = legs[0]
  const lastLeg = legs[legs.length - 1]

  // Route summary
  const origin = firstLeg.origin
  const destination = lastLeg.destination

  // Stop info — intermediate airports
  const stops = legs.slice(0, -1).map(l => l.destination)

  // Times in local airport TZ
  const depTz = getAirportTz(origin)
  const arrTz = getAirportTz(destination)
  const depBest = firstLeg.departureActual ?? firstLeg.departureEstimated ?? firstLeg.departureScheduled
  const arrBest = lastLeg.arrivalActual ?? lastLeg.arrivalEstimated ?? lastLeg.arrivalScheduled
  const depTime = formatLocalTime(depBest, depTz)
  const arrTime = formatLocalTime(arrBest, arrTz)

  // Date from first leg
  const depDate = formatDate(firstLeg.departureScheduled)

  // Status
  const status = worstStatus(legs.map(l => l.status))

  // Stop label
  const stopLabel = stops.length === 0
    ? 'Nonstop'
    : stops.length === 1
      ? `1 stop · ${stops[0]}`
      : `${stops.length} stops · ${stops.join(', ')}`

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, delay: index * 0.05, ease: [0.25, 0.46, 0.45, 0.94] }}
      whileTap={{ scale: 0.985 }}
    >
      <Link to={`/trips/${tripId}`} style={{ textDecoration: 'none', color: 'inherit' }}>
        <div className="card card-hover flight-card tear-stub">

          {/* Row 1: Route + Status badge */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem' }}>
            <div className="trip-card-route">
              <span>{origin}</span>
              <span style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: '0.9rem' }}>——·——→</span>
              <span>{destination}</span>
            </div>
            <StatusBadge status={status} />
          </div>

          {/* Row 2: Airline logo + ident + trip name */}
          <div className="flight-meta-row" style={{ marginTop: '0.3rem' }}>
            <AirlineLogo iata={firstLeg.airlineIata} size={18} style={{ borderRadius: 2 }} />
            <span className="flight-meta-ident">{firstLeg.ident}</span>
            {legs.length > 1 && (
              <>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>·</span>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{group.tripName}</span>
              </>
            )}
          </div>

          {/* Perforation divider */}
          <div className="flight-perforation" />

          {/* Row 3: dep time · stop info · arr time */}
          <div className="trip-card-times">
            <span style={{ color: 'var(--text)' }}>{depTime}</span>
            <span className="trip-card-stops">{stopLabel}</span>
            <span style={{ color: 'var(--text)' }}>{arrTime}</span>
          </div>

          {/* Row 4: date */}
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.3rem' }}>
            {depDate}
          </div>
        </div>
      </Link>
    </motion.div>
  )
}
