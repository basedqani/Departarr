import { useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { api } from '../lib/api'
import type { Flight, TripWithFlights } from '../lib/api'
import { StatusBadge } from '../components/StatusBadge'
import { AirlineLogo } from '../components/AirlineLogo'
import { formatLocalTime, formatDate, formatDuration, getAirportTz } from '../lib/format'

// ─── Connection helpers (mirrors TripGroup logic) ─────────────────────────────

type RiskLevel = 'green' | 'yellow' | 'red'

interface Connection {
  layoverMinutes: number
  risk: RiskLevel
  airport: string
}

function classifyRisk(minutes: number, sameTerminal: boolean): RiskLevel {
  const redT = sameTerminal ? 30 : 45
  const yellowT = sameTerminal ? 75 : 90
  if (minutes < redT) return 'red'
  if (minutes < yellowT) return 'yellow'
  return 'green'
}

function computeConnection(legN: Flight, legNplus1: Flight): Connection | null {
  if (legN.destination !== legNplus1.origin) return null
  const arrMs = new Date(
    (legN.arrivalActual ?? legN.arrivalEstimated ?? legN.arrivalScheduled) as string
  ).getTime()
  const depMs = new Date(legNplus1.departureScheduled).getTime()
  const minutes = Math.round((depMs - arrMs) / 60_000)
  const sameTerminal =
    legN.terminalArrival != null &&
    legNplus1.terminalDeparture != null &&
    legN.terminalArrival === legNplus1.terminalDeparture
  return { layoverMinutes: minutes, risk: classifyRisk(minutes, sameTerminal), airport: legN.destination }
}

// ─── Connection row ───────────────────────────────────────────────────────────

function ConnectionRow({ conn }: { conn: Connection }): React.ReactElement {
  const palettes = {
    red:    { bg: 'rgba(229,62,62,0.10)',  border: 'rgba(229,62,62,0.30)',  color: '#e53e3e', icon: '⚠', label: '— AT RISK' },
    yellow: { bg: 'rgba(214,158,46,0.10)', border: 'rgba(214,158,46,0.30)', color: '#d69e2e', icon: '⏱', label: '— Tight'   },
    green:  { bg: 'rgba(56,161,105,0.08)', border: 'rgba(56,161,105,0.25)', color: '#38a169', icon: '✓', label: ''          },
  }
  const p = palettes[conn.risk]
  return (
    <div
      className="trip-timeline-connection"
      style={{ background: p.bg, borderTop: `1px solid ${p.border}`, borderBottom: `1px solid ${p.border}`, color: p.color }}
    >
      <span style={{ height: 1, flex: 1, background: p.border }} />
      <span>{p.icon} {conn.layoverMinutes}m layover · {conn.airport} {p.label}</span>
      <span style={{ height: 1, flex: 1, background: p.border }} />
    </div>
  )
}

// ─── Inline leg detail ────────────────────────────────────────────────────────

function InlineLegDetail({ flight, connection }: { flight: Flight; connection: Connection | null }): React.ReactElement {
  const depTz = getAirportTz(flight.origin)
  const arrTz = getAirportTz(flight.destination)
  const depBest = flight.departureActual ?? flight.departureEstimated ?? flight.departureScheduled
  const arrBest = flight.arrivalActual ?? flight.arrivalEstimated ?? flight.arrivalScheduled
  const depTime = formatLocalTime(depBest, depTz)
  const arrTime = formatLocalTime(arrBest, arrTz)
  const durationMs = new Date(flight.arrivalScheduled).getTime() - new Date(flight.departureScheduled).getTime()

  return (
    <div className="trip-inline-detail">
      {/* Header row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
        <div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '1.1rem', fontWeight: 700, letterSpacing: '0.02em' }}>
            {flight.origin} → {flight.destination}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginTop: '0.25rem' }}>
            <AirlineLogo iata={flight.airlineIata} size={16} style={{ borderRadius: 2 }} />
            <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>{flight.ident}</span>
            {flight.aircraftType && (
              <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>· {flight.aircraftType}</span>
            )}
          </div>
        </div>
        <StatusBadge status={flight.status} />
      </div>

      {/* Times */}
      <div style={{ display: 'flex', gap: '1rem', marginBottom: '0.75rem' }}>
        <div>
          <div style={{ fontSize: '0.68rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)' }}>Departs</div>
          <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '1rem' }}>{depTime}</div>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{flight.origin}</div>
        </div>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: '0.72rem' }}>
          {formatDuration(durationMs)}
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: '0.68rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)' }}>Arrives</div>
          <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '1rem' }}>{arrTime}</div>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{flight.destination}</div>
        </div>
      </div>

      {/* Gate / Terminal / Seat / Confirmation */}
      {(flight.gateDeparture || flight.terminalDeparture || flight.seat || flight.confirmationCode) && (
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', padding: '0.6rem 0', borderTop: '1px dashed var(--hairline)', marginBottom: '0.5rem' }}>
          {flight.gateDeparture && (
            <div>
              <div style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)' }}>Gate</div>
              <div style={{ fontWeight: 700, fontFamily: 'var(--font-mono)' }}>{flight.gateDeparture}</div>
            </div>
          )}
          {flight.terminalDeparture && (
            <div>
              <div style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)' }}>Terminal</div>
              <div style={{ fontWeight: 700, fontFamily: 'var(--font-mono)' }}>{flight.terminalDeparture}</div>
            </div>
          )}
          {flight.seat && (
            <div>
              <div style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)' }}>Seat</div>
              <div style={{ fontWeight: 700, fontFamily: 'var(--font-mono)' }}>{flight.seat}</div>
            </div>
          )}
          {flight.confirmationCode && (
            <div>
              <div style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)' }}>Confirmation</div>
              <div style={{ fontWeight: 700, fontFamily: 'var(--font-mono)', letterSpacing: '0.08em' }}>{flight.confirmationCode}</div>
            </div>
          )}
        </div>
      )}

      {/* Connection risk badge */}
      {connection && connection.risk !== 'green' && (
        <div style={{
          marginBottom: '0.5rem',
          padding: '0.4rem 0.75rem',
          borderRadius: 'var(--radius-sm)',
          background: connection.risk === 'red' ? 'rgba(229,62,62,0.10)' : 'rgba(214,158,46,0.10)',
          border: `1px solid ${connection.risk === 'red' ? 'rgba(229,62,62,0.30)' : 'rgba(214,158,46,0.30)'}`,
          color: connection.risk === 'red' ? '#e53e3e' : '#d69e2e',
          fontSize: '0.78rem',
          fontWeight: 600,
          display: 'flex',
          alignItems: 'center',
          gap: '0.4rem',
        }}>
          {connection.risk === 'red' ? '⚠' : '⏱'}
          {connection.layoverMinutes}m to connect at {connection.airport}
          {connection.risk === 'red' ? ' — AT RISK' : ' — Tight'}
        </div>
      )}

      {/* View full details link */}
      <Link
        to={`/flights/${flight.id}`}
        style={{ fontSize: '0.78rem', color: 'var(--accent)', fontWeight: 600 }}
      >
        View full details →
      </Link>
    </div>
  )
}

// ─── Sorted legs builder ──────────────────────────────────────────────────────

function sortedLegs(trip: TripWithFlights): Flight[] {
  return [...trip.flights].sort(
    (a, b) => new Date(a.departureScheduled).getTime() - new Date(b.departureScheduled).getTime()
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function TripDetailPage(): React.ReactElement {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const { data: trip, isLoading } = useQuery({
    queryKey: ['trip', id],
    queryFn: () => api.trips.get(id!),
    refetchInterval: 60_000,
  })

  const legs = trip ? sortedLegs(trip) : []
  const [selectedId, setSelectedId] = useState<string | null>(null)

  // Default to first leg once loaded
  const effectiveSelectedId = selectedId ?? legs[0]?.id ?? null

  if (isLoading) return (
    <div className="loading" style={{ paddingTop: '4rem' }}>
      <div className="loading-spinner" />
      Loading trip…
    </div>
  )
  if (!trip) return <div className="error-box">Trip not found</div>

  // Build connections between consecutive legs
  const connections: (Connection | null)[] = legs.map((leg, i) =>
    i < legs.length - 1 ? computeConnection(leg, legs[i + 1]) : null
  )

  // Find the connection that arrives INTO the selected leg (inbound connection risk)
  const selectedIdx = legs.findIndex(l => l.id === effectiveSelectedId)
  const inboundConn = selectedIdx > 0 ? connections[selectedIdx - 1] : null

  const selectedFlight = legs.find(l => l.id === effectiveSelectedId) ?? null

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2 }}
    >
      {/* Page header */}
      <div className="page-header" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        <button
          className="secondary"
          style={{ padding: '0.4rem 0.75rem', fontSize: '0.85rem', flexShrink: 0 }}
          onClick={() => navigate(-1)}
        >
          ←
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={{ fontSize: '1.1rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {trip.name}
          </h1>
          {trip.startDate && (
            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.1rem' }}>
              {formatDate(trip.startDate)}{trip.endDate ? ` – ${formatDate(trip.endDate)}` : ''}
            </div>
          )}
        </div>
      </div>

      {legs.length === 0 && (
        <div className="empty">
          <h3>No flights in this trip</h3>
          <p>Add flights and assign them to this trip</p>
        </div>
      )}

      {/* Itinerary timeline */}
      {legs.length > 0 && (
        <div className="trip-detail-timeline">
          {legs.map((leg, i) => {
            const isSelected = leg.id === effectiveSelectedId
            const depTz = getAirportTz(leg.origin)
            const depBest = leg.departureActual ?? leg.departureEstimated ?? leg.departureScheduled
            const depTime = formatLocalTime(depBest, depTz)

            return (
              <div key={leg.id}>
                <div
                  className={`trip-timeline-leg${isSelected ? ' selected' : ''}`}
                  onClick={() => setSelectedId(leg.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') setSelectedId(leg.id) }}
                >
                  <AirlineLogo iata={leg.airlineIata} size={20} style={{ borderRadius: 2, flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                      <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '0.95rem' }}>
                        {leg.origin} → {leg.destination}
                      </span>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{leg.ident}</span>
                    </div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.1rem' }}>
                      {depTime} · {formatDate(leg.departureScheduled)}
                    </div>
                  </div>
                  <StatusBadge status={leg.status} />
                </div>

                {/* Connection row between legs */}
                {i < legs.length - 1 && connections[i] && (
                  <ConnectionRow conn={connections[i]!} />
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Inline leg detail */}
      {selectedFlight && (
        <InlineLegDetail flight={selectedFlight} connection={inboundConn} />
      )}
    </motion.div>
  )
}
