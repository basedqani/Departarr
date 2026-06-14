import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { api, type Flight } from '../lib/api'
import { formatDate, formatDuration } from '../lib/format'
import { getAirport } from '../lib/airports'
import { AirlineLogo } from '../components/AirlineLogo'

// Haversine great-circle distance in miles
function distanceMiles(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3958.8
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLon = ((lon2 - lon1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

interface Stats {
  totalFlights: number
  totalMiles: number
  totalDurationMs: number
  uniqueAirports: number
  uniqueAirlines: number
  longestFlight: Flight | null
  longestMiles: number
}

function computeStats(flights: Flight[]): Stats {
  let totalMiles = 0
  let totalDurationMs = 0
  let longestFlight: Flight | null = null
  let longestMiles = 0
  const airports = new Set<string>()
  const airlines = new Set<string>()

  for (const f of flights) {
    const orig = getAirport(f.origin)
    const dest = getAirport(f.destination)
    if (orig && dest) {
      const miles = distanceMiles(orig.lat, orig.lon, dest.lat, dest.lon)
      totalMiles += miles
      if (miles > longestMiles) { longestMiles = miles; longestFlight = f }
    }
    const dep = new Date(f.departureActual ?? f.departureScheduled).getTime()
    const arr = new Date(f.arrivalActual ?? f.arrivalScheduled).getTime()
    if (arr > dep) totalDurationMs += arr - dep

    airports.add(f.origin)
    airports.add(f.destination)
    if (f.airlineIata) airlines.add(f.airlineIata)
  }

  return {
    totalFlights: flights.length,
    totalMiles,
    totalDurationMs,
    uniqueAirports: airports.size,
    uniqueAirlines: airlines.size,
    longestFlight,
    longestMiles,
  }
}

function StatCell({ label, value, sub }: { label: string; value: string; sub?: string }): React.ReactElement {
  return (
    <div style={{ textAlign: 'center', padding: '0.5rem 0' }}>
      <div style={{ fontSize: '1.6rem', fontWeight: 700, fontFamily: 'var(--font-mono)', letterSpacing: '-0.02em', color: 'var(--text)', lineHeight: 1 }}>
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: '0.65rem', fontFamily: 'var(--font-mono)', color: 'var(--accent)', fontWeight: 600, marginTop: '0.1rem', letterSpacing: '0.04em' }}>
          {sub}
        </div>
      )}
      <div style={{ fontSize: '0.63rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: '0.25rem', fontWeight: 600 }}>
        {label}
      </div>
    </div>
  )
}

function PassportCard({ stats }: { stats: Stats }): React.ReactElement {
  const miles = Math.round(stats.totalMiles).toLocaleString()
  const duration = formatDuration(stats.totalDurationMs)
  const earthCircumference = 24901
  const laps = stats.totalMiles / earthCircumference

  return (
    <div style={{
      background: 'var(--surface)',
      border: '1px solid var(--hairline)',
      borderRadius: 8,
      overflow: 'hidden',
      marginBottom: '1.5rem',
      position: 'relative',
    }}>
      {/* Passport header strip */}
      <div style={{
        background: 'var(--text)',
        color: 'var(--bg)',
        padding: '0.6rem 1rem',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <div style={{ fontSize: '0.65rem', fontFamily: 'var(--font-mono)', letterSpacing: '0.12em', fontWeight: 600, opacity: 0.7, textTransform: 'uppercase' }}>
          Flight Passport
        </div>
        <div style={{ fontSize: '0.65rem', fontFamily: 'var(--font-mono)', letterSpacing: '0.05em', opacity: 0.6 }}>
          DEPARTARR · {new Date().getFullYear()}
        </div>
      </div>

      {/* Stats grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 0, padding: '1rem 0.75rem 0.5rem' }}>
        <StatCell label="Flights" value={String(stats.totalFlights)} />
        <StatCell label="Miles flown" value={miles} sub={laps >= 0.1 ? `${laps.toFixed(1)}× Earth` : undefined} />
        <StatCell label="Time in air" value={duration} />
        <StatCell label="Airports" value={String(stats.uniqueAirports)} />
        <StatCell label="Airlines" value={String(stats.uniqueAirlines)} />
        {stats.longestFlight && (
          <StatCell
            label="Longest"
            value={`${stats.longestFlight.origin}›${stats.longestFlight.destination}`}
            sub={`${Math.round(stats.longestMiles).toLocaleString()} mi`}
          />
        )}
      </div>

      {/* Machine-readable bottom strip */}
      <div style={{
        padding: '0.5rem 1rem 0.6rem',
        borderTop: '1px dashed var(--hairline)',
        marginTop: '0.25rem',
      }}>
        <div style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '0.52rem',
          color: 'var(--text-muted)',
          letterSpacing: '0.08em',
          opacity: 0.5,
          overflow: 'hidden',
          whiteSpace: 'nowrap',
        }}>
          {`P<DEPARTARR<<<FLIGHT<<<HISTORY<<<<<<<<<<<<<<<<<<<<<`}
        </div>
        <div style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '0.52rem',
          color: 'var(--text-muted)',
          letterSpacing: '0.08em',
          opacity: 0.5,
          marginTop: '0.1rem',
        }}>
          {`${String(stats.totalFlights).padStart(4, '0')}${String(stats.uniqueAirports).padStart(3, '0')}${String(Math.round(stats.totalMiles)).padStart(7, '0')}MI<<<`}
        </div>
      </div>
    </div>
  )
}

function groupByYear(flights: Flight[]): Map<string, Flight[]> {
  const groups = new Map<string, Flight[]>()
  for (const f of [...flights].reverse()) {
    const year = new Date(f.departureScheduled).getFullYear().toString()
    if (!groups.has(year)) groups.set(year, [])
    groups.get(year)!.push(f)
  }
  return groups
}

function FlightStamp({ flight, index }: { flight: Flight; index: number }): React.ReactElement {
  const dep = new Date(flight.departureScheduled)
  const monthDay = dep.toLocaleDateString([], { month: 'short', day: 'numeric' })

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, delay: index * 0.025 }}
    >
      <Link to={`/flights/${flight.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem',
          padding: '0.55rem 0',
          borderBottom: '1px solid var(--hairline)',
        }}>
          {/* Date stamp */}
          <div style={{
            width: 36,
            flexShrink: 0,
            textAlign: 'center',
            fontSize: '0.65rem',
            color: 'var(--text-muted)',
            fontFamily: 'var(--font-mono)',
            letterSpacing: '0.02em',
            lineHeight: 1.2,
          }}>
            {monthDay.split(' ')[0].toUpperCase()}
            <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text)', lineHeight: 1 }}>
              {monthDay.split(' ')[1]}
            </div>
          </div>

          {/* Airline logo */}
          <AirlineLogo iata={flight.airlineIata} size={22} style={{ borderRadius: 3, opacity: 0.85 }} />

          {/* Route */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '0.88rem', letterSpacing: '0.04em', color: 'var(--text)' }}>
              {flight.origin} › {flight.destination}
            </div>
            <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '0.05rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {flight.ident}
              {flight.trip && ` · ${flight.trip.name}`}
            </div>
          </div>

          {/* Chevron */}
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-muted)', flexShrink: 0, opacity: 0.5 }}>
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </div>
      </Link>
    </motion.div>
  )
}

export function PastPage(): React.ReactElement {
  const { data: flights, isLoading } = useQuery({
    queryKey: ['flights', 'past'],
    queryFn: () => api.flights.list('past'),
  })

  const [showAll, setShowAll] = useState(false)

  const stats = flights ? computeStats(flights) : null
  const yearGroups = flights ? groupByYear(flights) : new Map<string, Flight[]>()

  // Show most recent year expanded, rest collapsed unless showAll
  const years = [...yearGroups.keys()]
  const visibleYears = showAll ? years : years.slice(0, 1)

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2 }}
    >
      <div className="page-header">
        <h1>Past Flights</h1>
      </div>

      {isLoading && (
        <div className="loading">
          <div className="loading-spinner" />
          Loading…
        </div>
      )}

      {flights && flights.length === 0 && !isLoading && (
        <div className="empty">
          <h3>No past flights yet</h3>
          <p>Your flight history and stats will appear here</p>
        </div>
      )}

      {stats && stats.totalFlights > 0 && (
        <PassportCard stats={stats} />
      )}

      {visibleYears.map((year) => {
        const yearFlights = yearGroups.get(year) ?? []
        return (
          <div key={year} style={{ marginBottom: '1.5rem' }}>
            <div style={{
              fontSize: '0.65rem',
              fontWeight: 700,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              color: 'var(--text-muted)',
              marginBottom: '0.25rem',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'baseline',
            }}>
              <span>{year}</span>
              <span style={{ fontWeight: 400, letterSpacing: '0.04em' }}>{yearFlights.length} flight{yearFlights.length !== 1 ? 's' : ''}</span>
            </div>
            <div style={{ background: 'var(--surface)', border: '1px solid var(--hairline)', borderRadius: 8, padding: '0 0.75rem' }}>
              {yearFlights.map((f, i) => (
                <FlightStamp key={f.id} flight={f} index={i} />
              ))}
            </div>
          </div>
        )
      })}

      {years.length > 1 && !showAll && (
        <button
          className="secondary"
          style={{ width: '100%', padding: '0.65rem', fontSize: '0.82rem' }}
          onClick={() => setShowAll(true)}
        >
          Show {years.length - 1} more year{years.length - 1 !== 1 ? 's' : ''}
        </button>
      )}

      {flights && flights.length > 0 && (
        <div style={{ textAlign: 'center', marginTop: '1rem', fontSize: '0.65rem', color: 'var(--text-muted)', opacity: 0.5 }}>
          {formatDate(flights[flights.length - 1]?.departureScheduled)} — {formatDate(flights[0]?.departureScheduled)}
        </div>
      )}
    </motion.div>
  )
}
