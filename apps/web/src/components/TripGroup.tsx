import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import type { TripGroupItem, InlineConnection } from '../lib/tripGrouping'
import { FlightCard } from './FlightCard'

function ConnectionRow({ conn }: { conn: InlineConnection }): React.ReactElement {
  const palettes = {
    red: {
      bg: 'rgba(229,62,62,0.10)',
      border: 'rgba(229,62,62,0.30)',
      color: '#e53e3e',
      icon: '⚠️',
      label: '— AT RISK',
    },
    yellow: {
      bg: 'rgba(214,158,46,0.10)',
      border: 'rgba(214,158,46,0.30)',
      color: '#d69e2e',
      icon: '⏱',
      label: '— Tight',
    },
    green: {
      bg: 'rgba(56,161,105,0.08)',
      border: 'rgba(56,161,105,0.25)',
      color: '#38a169',
      icon: '✓',
      label: '',
    },
  }
  const p = palettes[conn.risk]
  return (
    <div
      className="trip-connection-row"
      style={{
        background: p.bg,
        borderTop: `1px solid ${p.border}`,
        borderBottom: `1px solid ${p.border}`,
        color: p.color,
      }}
    >
      <span className="trip-connection-line" />
      <span className="trip-connection-text">
        {p.icon} {conn.layoverMinutes}m layover · {conn.airport} {p.label}
      </span>
      <span className="trip-connection-line" />
    </div>
  )
}

export function TripGroup({
  group,
  startIndex = 0,
}: {
  group: TripGroupItem
  startIndex?: number
}): React.ReactElement {
  return (
    <motion.div
      className="trip-group"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, delay: startIndex * 0.04 }}
    >
      <Link to={`/trips/${group.tripId}`} className="trip-group-header">
        ✈ {group.tripName} · {group.legs.length} leg{group.legs.length > 1 ? 's' : ''}
      </Link>
      <div className="trip-group-body">
        {group.legs.map((leg, i) => (
          <div key={leg.id}>
            <FlightCard flight={leg} index={startIndex} />
            {i < group.legs.length - 1 && group.connections[i] && (
              <ConnectionRow conn={group.connections[i]!} />
            )}
          </div>
        ))}
      </div>
    </motion.div>
  )
}
