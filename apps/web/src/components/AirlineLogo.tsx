import { useState } from 'react'

interface Props {
  iata: string | null | undefined
  size?: number
  className?: string
  style?: React.CSSProperties
}

// Google Flights CDN — has logos for virtually all major carriers.
function logoUrl(iata: string): string {
  return `https://www.gstatic.com/flights/airline_logos/70px/${iata}.png`
}

export function AirlineLogo({ iata, size = 28, className, style }: Props): React.ReactElement | null {
  const [failed, setFailed] = useState(false)

  if (!iata || failed) return null

  return (
    <img
      src={logoUrl(iata.toUpperCase())}
      alt={iata}
      width={size}
      height={size}
      className={className}
      onError={() => setFailed(true)}
      style={{
        objectFit: 'contain',
        borderRadius: 4,
        flexShrink: 0,
        ...style,
      }}
    />
  )
}
