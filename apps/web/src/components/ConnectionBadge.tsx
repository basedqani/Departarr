import type { ConnectionResult } from '../lib/api'

export function ConnectionBadge({ conn }: { conn: ConnectionResult }): React.ReactElement {
  const color = conn.risk === 'red' ? '#e53e3e' : '#d69e2e'
  const icon = conn.risk === 'red' ? '⚠️' : '⏱'
  const mins = conn.minutesAvailable
  return (
    <div
      className="connection-badge"
      style={
        {
          '--badge-color': color,
          background: conn.risk === 'red' ? 'rgba(229,62,62,0.12)' : 'rgba(214,158,46,0.12)',
          border: `1px solid ${conn.risk === 'red' ? 'rgba(229,62,62,0.35)' : 'rgba(214,158,46,0.35)'}`,
        } as React.CSSProperties
      }
    >
      {icon} {mins}m connection at {conn.airport}
      {conn.risk === 'red' ? ' — AT RISK' : ' — Tight'}
    </div>
  )
}
