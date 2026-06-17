import { useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { api } from '../lib/api'
import type { Flight, Train, TripWithLegs, TrainStop } from '../lib/api'
import { StatusBadge } from '../components/StatusBadge'
import { AirlineLogo } from '../components/AirlineLogo'
import { formatLocalTime, formatDate, formatDuration, getAirportTz, getAmtrakStationTz } from '../lib/format'

// ─── Types ────────────────────────────────────────────────────────────────────

type TripLegItem =
  | { legType: 'flight'; data: Flight; sortKey: number }
  | { legType: 'train'; data: Train; sortKey: number }

// Train times are rendered in the station's own timezone (resolved via the
// Amtrak station tz map). When a station code is unknown the formatter falls
// back to UTC with an explicit "UTC" label — never the viewer's machine zone —
// so a departure time is never silently shifted.
function fmtTrainTime(iso: string, stationCode: string): string {
  return formatLocalTime(iso, getAmtrakStationTz(stationCode))
}

// ─── Connection helpers ────────────────────────────────────────────────────────

type RiskLevel = 'green' | 'yellow' | 'red'

interface Connection {
  layoverMinutes: number
  risk: RiskLevel
  airport: string
  gapOnly?: boolean
}

function classifyRisk(minutes: number, sameTerminal: boolean): RiskLevel {
  const redT = sameTerminal ? 30 : 45
  const yellowT = sameTerminal ? 75 : 90
  if (minutes < redT) return 'red'
  if (minutes < yellowT) return 'yellow'
  return 'green'
}

function computeConnection(legA: TripLegItem, legB: TripLegItem): Connection | null {
  const destA = legA.data.destination
  const origB = legB.data.origin
  const arrBest = legA.data.arrivalActual ?? legA.data.arrivalEstimated ?? legA.data.arrivalScheduled
  const depMs = new Date(legB.data.departureScheduled).getTime()
  const arrMs = new Date(arrBest).getTime()
  const minutes = Math.round((depMs - arrMs) / 60_000)

  if (destA !== origB) {
    return { layoverMinutes: minutes, risk: 'green', airport: origB, gapOnly: true }
  }

  const sameTerminal =
    legA.legType === 'flight' &&
    legB.legType === 'flight' &&
    legA.data.terminalArrival != null &&
    legB.data.terminalDeparture != null &&
    legA.data.terminalArrival === legB.data.terminalDeparture

  return {
    layoverMinutes: minutes,
    risk: classifyRisk(minutes, sameTerminal),
    airport: destA,
  }
}

// ─── Connection row ───────────────────────────────────────────────────────────

function fmtLayover(minutes: number): string {
  const absMin = Math.abs(minutes)
  const h = Math.floor(absMin / 60)
  const m = absMin % 60
  if (h === 0) return `${m}m`
  if (m === 0) return `${h}h`
  return `${h}h ${m}m`
}

function ConnectionRow({ conn }: { conn: Connection }): React.ReactElement {
  if (conn.gapOnly) {
    const absMin = Math.abs(conn.layoverMinutes)
    const days = Math.floor(absMin / (60 * 24))
    const label = days >= 1
      ? `${days} day${days !== 1 ? 's' : ''} in ${conn.airport}`
      : `${fmtLayover(conn.layoverMinutes)} until next leg · ${conn.airport}`
    return (
      <div
        className="trip-timeline-connection"
        style={{ background: 'rgba(138,155,176,0.08)', borderTop: '1px solid rgba(138,155,176,0.2)', borderBottom: '1px solid rgba(138,155,176,0.2)', color: 'var(--text-muted)' }}
      >
        <span style={{ height: 1, flex: 1, background: 'rgba(138,155,176,0.2)' }} />
        <span>{label}</span>
        <span style={{ height: 1, flex: 1, background: 'rgba(138,155,176,0.2)' }} />
      </div>
    )
  }

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
      <span>{p.icon} {fmtLayover(conn.layoverMinutes)} layover · {conn.airport} {p.label}</span>
      <span style={{ height: 1, flex: 1, background: p.border }} />
    </div>
  )
}

// ─── Icons ────────────────────────────────────────────────────────────────────

function TrainIcon(): React.ReactElement {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, color: 'var(--text-muted)' }}>
      <rect x="4" y="3" width="16" height="13" rx="2" />
      <path d="M4 11h16" />
      <path d="M12 3v8" />
      <path d="M8 19l-2 3" />
      <path d="M18 22l-2-3" />
      <path d="M7 19h10" />
    </svg>
  )
}

// ─── Inline train detail ──────────────────────────────────────────────────────

function InlineTrainDetail({ train, connection }: { train: Train; connection: Connection | null }): React.ReactElement {
  const queryClient = useQueryClient()
  const [editSeat, setEditSeat] = useState(false)
  const [editConf, setEditConf] = useState(false)
  const [seatVal, setSeatVal] = useState(train.seat ?? '')
  const [confVal, setConfVal] = useState(train.confirmationCode ?? '')

  const mutation = useMutation({
    mutationFn: (data: { seat?: string | null; confirmationCode?: string | null }) =>
      api.trains.patch(train.id, data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['trip'] })
    },
  })

  const stops: TrainStop[] = (() => {
    try { return JSON.parse(train.stopsJson ?? '[]') as TrainStop[] }
    catch { return [] }
  })()

  const depTime = fmtTrainTime(train.departureActual ?? train.departureEstimated ?? train.departureScheduled, train.origin)
  const arrTime = fmtTrainTime(train.arrivalActual ?? train.arrivalEstimated ?? train.arrivalScheduled, train.destination)
  const durationMs = new Date(train.arrivalScheduled).getTime() - new Date(train.departureScheduled).getTime()

  return (
    <div className="trip-inline-detail">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
        <div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '1.1rem', fontWeight: 700, letterSpacing: '0.02em' }}>
            {train.origin} → {train.destination}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginTop: '0.25rem' }}>
            <TrainIcon />
            <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
              Train {train.trainNumber}{train.trainName ? ` · ${train.trainName}` : ''}
            </span>
          </div>
        </div>
        <StatusBadge status={train.status} />
      </div>

      <div style={{ display: 'flex', gap: '1rem', marginBottom: '0.75rem' }}>
        <div>
          <div style={{ fontSize: '0.68rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)' }}>Departs</div>
          <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '1rem' }}>{depTime}</div>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{train.originName ?? train.origin}</div>
        </div>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: '0.72rem' }}>
          {formatDuration(durationMs)}
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: '0.68rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)' }}>Arrives</div>
          <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '1rem' }}>{arrTime}</div>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{train.destinationName ?? train.destination}</div>
        </div>
      </div>

      {/* Seat + Confirmation (editable) */}
      <div style={{ padding: '0.6rem 0', borderTop: '1px dashed var(--hairline)', marginBottom: '0.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
          <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>Seat</span>
          {editSeat ? (
            <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
              <input value={seatVal} onChange={e => setSeatVal(e.target.value)} placeholder="e.g. 14" autoFocus style={{ width: 80, padding: '0.2rem 0.4rem', fontSize: '0.82rem' }} onKeyDown={e => { if (e.key === 'Enter') { mutation.mutate({ seat: seatVal.trim() || null }); setEditSeat(false) } }} />
              <button style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem' }} onClick={() => { mutation.mutate({ seat: seatVal.trim() || null }); setEditSeat(false) }}>Save</button>
              <button className="secondary" style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem' }} onClick={() => { setEditSeat(false); setSeatVal(train.seat ?? '') }}>Cancel</button>
            </div>
          ) : (
            <button className="secondary" style={{ padding: '0.2rem 0.6rem', fontSize: '0.78rem' }} onClick={() => setEditSeat(true)}>
              {train.seat ?? <span style={{ color: 'var(--accent)' }}>+ Add seat</span>}
            </button>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>Confirmation</span>
          {editConf ? (
            <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
              <input value={confVal} onChange={e => setConfVal(e.target.value)} placeholder="e.g. ABC123" autoFocus style={{ width: 110, padding: '0.2rem 0.4rem', fontSize: '0.82rem' }} onKeyDown={e => { if (e.key === 'Enter') { mutation.mutate({ confirmationCode: confVal.trim() || null }); setEditConf(false) } }} />
              <button style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem' }} onClick={() => { mutation.mutate({ confirmationCode: confVal.trim() || null }); setEditConf(false) }}>Save</button>
              <button className="secondary" style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem' }} onClick={() => { setEditConf(false); setConfVal(train.confirmationCode ?? '') }}>Cancel</button>
            </div>
          ) : (
            <button className="secondary" style={{ padding: '0.2rem 0.6rem', fontSize: '0.78rem', fontFamily: 'monospace' }} onClick={() => setEditConf(true)}>
              {train.confirmationCode ?? <span style={{ color: 'var(--accent)', fontFamily: 'inherit' }}>+ Add confirmation</span>}
            </button>
          )}
        </div>
      </div>

      {/* Stop progress list */}
      {stops.length > 0 && (
        <div style={{ marginBottom: '0.5rem' }}>
          <div style={{ fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', marginBottom: '0.4rem' }}>
            Stops
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', maxHeight: 200, overflowY: 'auto' }}>
            {stops.map((stop, i) => {
              const passed = !!stop.arr || !!stop.dep
              const isCurrent = !passed && i > 0 && !!stops[i - 1]?.dep
              const schTime = stop.schDep ?? stop.schArr
              const hasDelay = !!(stop.depCmnt ?? stop.arrCmnt)
              return (
                <div key={`${stop.code}-${i}`} style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  fontSize: '0.75rem',
                  color: passed ? 'var(--on-time)' : isCurrent ? 'var(--accent)' : 'var(--text-muted)',
                }}>
                  <span style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    flexShrink: 0,
                    background: passed ? 'var(--on-time)' : isCurrent ? 'var(--accent)' : 'var(--hairline)',
                  }} />
                  <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, minWidth: 36 }}>{stop.code}</span>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{stop.name}</span>
                  {schTime && (
                    <span style={{ fontFamily: 'var(--font-mono)', flexShrink: 0 }}>
                      {schTime.substring(0, 5)}
                      {hasDelay && <span style={{ color: '#fbbf24', marginLeft: '0.25rem' }}>!</span>}
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {connection && !connection.gapOnly && connection.risk !== 'green' && (
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

      <Link to={`/trains/${train.id}`} style={{ fontSize: '0.78rem', color: 'var(--accent)', fontWeight: 600 }}>
        View full details →
      </Link>
    </div>
  )
}

// ─── Inline flight detail ─────────────────────────────────────────────────────

function InlineFlightDetail({ flight, connection }: { flight: Flight; connection: Connection | null }): React.ReactElement {
  const depTz = getAirportTz(flight.origin)
  const arrTz = getAirportTz(flight.destination)
  const depBest = flight.departureActual ?? flight.departureEstimated ?? flight.departureScheduled
  const arrBest = flight.arrivalActual ?? flight.arrivalEstimated ?? flight.arrivalScheduled
  const depTime = formatLocalTime(depBest, depTz)
  const arrTime = formatLocalTime(arrBest, arrTz)
  const durationMs = new Date(flight.arrivalScheduled).getTime() - new Date(flight.departureScheduled).getTime()

  return (
    <div className="trip-inline-detail">
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

      {connection && !connection.gapOnly && connection.risk !== 'green' && (
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

      <Link to={`/flights/${flight.id}`} style={{ fontSize: '0.78rem', color: 'var(--accent)', fontWeight: 600 }}>
        View full details →
      </Link>
    </div>
  )
}

// ─── Sorted legs builder ──────────────────────────────────────────────────────

function buildSortedLegs(trip: TripWithLegs): TripLegItem[] {
  const legs: TripLegItem[] = [
    ...trip.flights.map(f => ({ legType: 'flight' as const, data: f, sortKey: new Date(f.departureScheduled).getTime() })),
    ...(trip.trains ?? []).map(t => ({ legType: 'train' as const, data: t, sortKey: new Date(t.departureScheduled).getTime() })),
  ]
  return legs.sort((a, b) => a.sortKey - b.sortKey)
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function TripDetailPage(): React.ReactElement {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const { data: trip, isLoading } = useQuery({
    queryKey: ['trip', id],
    queryFn: () => api.trips.get(id!),
    refetchInterval: 60_000,
  })

  const legs = trip ? buildSortedLegs(trip) : []
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const effectiveSelectedId = selectedId ?? legs[0]?.data.id ?? null

  async function handleDeleteTrip(): Promise<void> {
    setDeleting(true)
    try {
      await api.trips.delete(id!)
      await queryClient.invalidateQueries({ queryKey: ['trips'] })
      navigate('/upcoming')
    } catch (err) {
      setDeleting(false)
      setConfirmDelete(false)
      alert(err instanceof Error ? err.message : 'Could not delete this trip')
    }
  }

  if (isLoading) return (
    <div className="loading" style={{ paddingTop: '4rem' }}>
      <div className="loading-spinner" />
      Loading trip…
    </div>
  )
  if (!trip) return <div className="error-box">Trip not found</div>

  const connections: (Connection | null)[] = legs.map((leg, i) =>
    i < legs.length - 1 ? computeConnection(leg, legs[i + 1]) : null
  )

  const selectedIdx = legs.findIndex(l => l.data.id === effectiveSelectedId)
  const inboundConn = selectedIdx > 0 ? connections[selectedIdx - 1] : null
  const selectedLeg = legs.find(l => l.data.id === effectiveSelectedId) ?? null

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
        {confirmDelete ? (
          <>
            <button
              className="secondary"
              style={{ padding: '0.4rem 0.75rem', fontSize: '0.8rem', flexShrink: 0 }}
              onClick={() => setConfirmDelete(false)}
              disabled={deleting}
            >
              Cancel
            </button>
            <button
              className="danger"
              style={{ padding: '0.4rem 0.75rem', fontSize: '0.8rem', flexShrink: 0, whiteSpace: 'nowrap' }}
              onClick={() => void handleDeleteTrip()}
              disabled={deleting}
            >
              {deleting ? 'Deleting…' : 'Confirm delete'}
            </button>
          </>
        ) : (
          <button
            className="danger"
            style={{ padding: '0.4rem 0.75rem', fontSize: '0.8rem', flexShrink: 0 }}
            onClick={() => setConfirmDelete(true)}
          >
            Delete
          </button>
        )}
      </div>

      {legs.length === 0 && (
        <div className="empty">
          <h3>No legs in this trip</h3>
          <p>Add flights or trains and assign them to this trip</p>
        </div>
      )}

      {legs.length > 0 && (
        <div className="trip-detail-timeline">
          {legs.map((leg, i) => {
            const isSelected = leg.data.id === effectiveSelectedId
            const legId = leg.data.id

            if (leg.legType === 'flight') {
              const flight = leg.data
              const depTz = getAirportTz(flight.origin)
              const depBest = flight.departureActual ?? flight.departureEstimated ?? flight.departureScheduled
              const depTime = formatLocalTime(depBest, depTz)

              return (
                <div key={legId}>
                  <div
                    className={`trip-timeline-leg${isSelected ? ' selected' : ''}`}
                    onClick={() => setSelectedId(legId)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') setSelectedId(legId) }}
                  >
                    <AirlineLogo iata={flight.airlineIata} size={20} style={{ borderRadius: 2, flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                        <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '0.95rem' }}>
                          {flight.origin} → {flight.destination}
                        </span>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{flight.ident}</span>
                      </div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.1rem' }}>
                        {depTime} · {formatDate(flight.departureScheduled)}
                      </div>
                    </div>
                    <StatusBadge status={flight.status} />
                  </div>
                  {i < legs.length - 1 && connections[i] && (
                    <ConnectionRow conn={connections[i]!} />
                  )}
                </div>
              )
            }

            // Train leg
            const train = leg.data
            const depTime = fmtTrainTime(train.departureActual ?? train.departureEstimated ?? train.departureScheduled, train.origin)

            return (
              <div key={legId}>
                <div
                  className={`trip-timeline-leg${isSelected ? ' selected' : ''}`}
                  onClick={() => setSelectedId(legId)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') setSelectedId(legId) }}
                >
                  <TrainIcon />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                      <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '0.95rem' }}>
                        {train.origin} → {train.destination}
                      </span>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                        Train {train.trainNumber}{train.trainName ? ` · ${train.trainName}` : ''}
                      </span>
                    </div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.1rem' }}>
                      {depTime} · {formatDate(train.departureScheduled)}
                    </div>
                  </div>
                  <StatusBadge status={train.status} />
                </div>
                {i < legs.length - 1 && connections[i] && (
                  <ConnectionRow conn={connections[i]!} />
                )}
              </div>
            )
          })}
        </div>
      )}

      {selectedLeg && selectedLeg.legType === 'flight' && (
        <InlineFlightDetail flight={selectedLeg.data} connection={inboundConn} />
      )}
      {selectedLeg && selectedLeg.legType === 'train' && (
        <InlineTrainDetail train={selectedLeg.data} connection={inboundConn} />
      )}
    </motion.div>
  )
}
