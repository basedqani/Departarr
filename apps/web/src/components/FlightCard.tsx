import { Link } from 'react-router-dom'
import type { Flight } from '../lib/api'
import { StatusBadge } from './StatusBadge'
import { formatTime, formatDate } from '../lib/format'

interface Props {
  flight: Flight
  showDate?: boolean
}

export function FlightCard({ flight, showDate }: Props): React.ReactElement {
  const depTime = flight.departureActual ?? flight.departureEstimated ?? flight.departureScheduled
  const arrTime = flight.arrivalActual ?? flight.arrivalEstimated ?? flight.arrivalScheduled

  return (
    <Link to={`/flights/${flight.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
      <div className="card card-hover flight-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div className="flight-route">
            <span>{flight.origin}</span>
            <span className="flight-route-arrow">→</span>
            <span>{flight.destination}</span>
          </div>
          <StatusBadge status={flight.status} />
        </div>

        <div className="flight-meta">
          <span>{flight.ident}</span>
          {showDate && <span>{formatDate(flight.departureScheduled)}</span>}
          <span>{formatTime(depTime)} → {formatTime(arrTime)}</span>
          {flight.gateDeparture && <span>Gate {flight.gateDeparture}</span>}
          {flight.terminalDeparture && <span>Terminal {flight.terminalDeparture}</span>}
          {flight.aircraftType && <span>{flight.aircraftType}</span>}
        </div>

        {flight.trip && (
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            Trip: {flight.trip.name}
          </div>
        )}
      </div>
    </Link>
  )
}
