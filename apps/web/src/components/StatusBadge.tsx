interface Props {
  status: string
}

export function StatusBadge({ status }: Props): React.ReactElement {
  const normalized = status.toLowerCase().replace(/[\s_]+/g, '-')
  const knownStatuses = [
    'scheduled', 'boarding', 'departed', 'en-route',
    'landed', 'arrived', 'delayed', 'cancelled', 'diverted',
  ]
  const cls = knownStatuses.includes(normalized) ? normalized : 'unknown'

  return (
    <span className={`badge badge-${cls}`}>
      {status.replace(/_/g, ' ')}
    </span>
  )
}
