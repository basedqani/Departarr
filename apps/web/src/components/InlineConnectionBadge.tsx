import { formatLayover, type InlineConnection } from '../lib/tripGrouping'

/**
 * Compact layover/connection badge shown between two legs of an itinerary
 * (manual trip or auto-detected connecting itinerary). Renders the layover
 * duration, the connecting airport, and a risk colour. Green (comfortable)
 * connections are hidden unless `showGreen` is set.
 */
export function InlineConnectionBadge({
  conn,
  showGreen = false,
}: {
  conn: InlineConnection
  showGreen?: boolean
}): React.ReactElement | null {
  if (conn.risk === 'green' && !showGreen) return null
  const palettes = {
    red:    { bg: 'rgba(229,62,62,0.10)',  border: 'rgba(229,62,62,0.35)',  color: '#e53e3e', icon: '⚠', label: '— AT RISK' },
    yellow: { bg: 'rgba(214,158,46,0.10)', border: 'rgba(214,158,46,0.35)', color: '#d69e2e', icon: '⏱', label: '— Tight'   },
    green:  { bg: 'rgba(56,161,105,0.06)', border: 'rgba(56,161,105,0.20)', color: '#38a169', icon: '✓', label: ''          },
  }
  const p = palettes[conn.risk]
  return (
    <div style={{
      margin: '0 0 0.5rem',
      padding: '0.4rem 0.875rem',
      borderRadius: 8,
      background: p.bg,
      border: `1px solid ${p.border}`,
      color: p.color,
      fontSize: '0.78rem',
      fontWeight: 600,
      display: 'flex',
      alignItems: 'center',
      gap: '0.4rem',
    }}>
      {p.icon} {formatLayover(conn.layoverMinutes)} layover · {conn.airport}{p.label ? ` ${p.label}` : ''}
      {conn.sameTerminal && (
        <span style={{ fontSize: '0.7rem', fontWeight: 400, opacity: 0.75 }}>· same terminal</span>
      )}
    </div>
  )
}
