interface Props {
  status: string
  size?: 'sm' | 'md'
}

export function StatusBadge({ status }: Props): React.ReactElement {
  const normalized = status.toLowerCase().replace(/[\s_]+/g, '-')
  const knownStatuses = [
    'scheduled', 'boarding', 'departed', 'en-route',
    'landed', 'arrived', 'delayed', 'cancelled', 'diverted',
    'at-station',
  ]
  const cls = knownStatuses.includes(normalized) ? normalized : 'unknown'
  const isLive = normalized === 'boarding' || normalized === 'departed' || normalized === 'en-route' || normalized === 'at-station'

  return (
    <span className={`badge badge-${cls}`}>
      {isLive && <span className="badge-live-dot" />}
      {status.replace(/_/g, ' ')}
    </span>
  )
}
