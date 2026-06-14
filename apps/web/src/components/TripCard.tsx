import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import type { TripGroupItem, TripLeg } from '../lib/tripGrouping'
import { legOrigin, legDestination, legStatus } from '../lib/tripGrouping'
import { StatusBadge } from './StatusBadge'
import { AirlineLogo } from './AirlineLogo'
import { formatLocalTime, formatDate, getAirportTz } from '../lib/format'

/** Returns the "worst" status across all legs of a trip.
 *  Priority: cancelled > delayed > en-route/at-station > boarding > scheduled/on-time */
function worstStatus(statuses: string[]): string {
  const rank = (s: string): number => {
    const st = s.toLowerCase().replace(/[\s_]+/g, '-')
    if (st === 'cancelled') return 5
    if (st === 'delayed') return 4
    if (st === 'en-route' || st === 'departed' || st === 'at-station') return 3
    if (st === 'boarding') return 2
    if (st === 'arrived' || st === 'landed') return 1
    return 0
  }
  return statuses.reduce((best, cur) => rank(cur) > rank(best) ? cur : best, statuses[0] ?? 'Scheduled')
}

function TrainIconSmall(): React.ReactElement {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, color: 'var(--text-muted)' }}>
      <rect x="4" y="3" width="16" height="13" rx="2" />
      <path d="M4 11h16" />
      <path d="M12 3v8" />
      <path d="M8 19l-2 3" />
      <path d="M18 22l-2-3" />
      <path d="M7 19h10" />
    </svg>
  )
}

function getModeLabel(legs: TripLeg[]): string | null {
  const hasFlights = legs.some(l => l.legType === 'flight')
  const hasTrains = legs.some(l => l.legType === 'train')
  if (hasFlights && hasTrains) {
    const flightCount = legs.filter(l => l.legType === 'flight').length
    const trainCount = legs.filter(l => l.legType === 'train').length
    return `${flightCount} flight${flightCount !== 1 ? 's' : ''} · ${trainCount} train${trainCount !== 1 ? 's' : ''}`
  }
  return null
}

function LegCountLabel(legs: TripLeg[]): string {
  const hasFlights = legs.some(l => l.legType === 'flight')
  const hasTrains = legs.some(l => l.legType === 'train')
  const mixed = hasFlights && hasTrains
  const count = legs.length - 1 // intermediate legs

  if (mixed) {
    return count === 0 ? 'Direct' : `${legs.length} legs`
  }
  if (count === 0) return 'Nonstop'
  const stops = legs.slice(0, -1).map(l => legDestination(l))
  return count === 1
    ? `1 stop · ${stops[0]}`
    : `${count} stops · ${stops.join(', ')}`
}

interface Props {
  group: TripGroupItem
  index?: number
}

export function TripCard({ group, index = 0 }: Props): React.ReactElement {
  const { legs, tripId } = group
  const firstLeg = legs[0]
  const lastLeg = legs[legs.length - 1]

  const origin = legOrigin(firstLeg)
  const destination = legDestination(lastLeg)

  // Times — use browser TZ for trains, airport TZ for flights
  const depTz = firstLeg.legType === 'flight' ? getAirportTz(origin) : undefined
  const arrTz = lastLeg.legType === 'flight' ? getAirportTz(destination) : undefined

  const depBestIso = firstLeg.legType === 'flight'
    ? (firstLeg.data.departureActual ?? firstLeg.data.departureEstimated ?? firstLeg.data.departureScheduled)
    : (firstLeg.data.departureActual ?? firstLeg.data.departureEstimated ?? firstLeg.data.departureScheduled)

  const arrBestIso = lastLeg.legType === 'flight'
    ? (lastLeg.data.arrivalActual ?? lastLeg.data.arrivalEstimated ?? lastLeg.data.arrivalScheduled)
    : (lastLeg.data.arrivalActual ?? lastLeg.data.arrivalEstimated ?? lastLeg.data.arrivalScheduled)

  const depTime = formatLocalTime(depBestIso, depTz)
  const arrTime = formatLocalTime(arrBestIso, arrTz)

  const depDate = formatDate(firstLeg.data.departureScheduled)
  const status = worstStatus(legs.map(l => legStatus(l)))
  const stopLabel = LegCountLabel(legs)
  const modeLabel = getModeLabel(legs)

  // First leg icon — airline logo for flights, train icon for trains
  const firstLegIcon = firstLeg.legType === 'flight'
    ? <AirlineLogo iata={firstLeg.data.airlineIata} size={18} style={{ borderRadius: 2 }} />
    : <TrainIconSmall />

  const firstLegIdent = firstLeg.legType === 'flight' ? firstLeg.data.ident : `Train ${firstLeg.data.trainNumber}`

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

          {/* Row 2: Lead leg icon + ident + trip name */}
          <div className="flight-meta-row" style={{ marginTop: '0.3rem' }}>
            {firstLegIcon}
            <span className="flight-meta-ident">{firstLegIdent}</span>
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

          {/* Row 4: date + mode label if mixed */}
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.3rem', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <span>{depDate}</span>
            {modeLabel && (
              <>
                <span>·</span>
                <span style={{ color: 'var(--accent)', fontWeight: 600 }}>{modeLabel}</span>
              </>
            )}
          </div>
        </div>
      </Link>
    </motion.div>
  )
}
