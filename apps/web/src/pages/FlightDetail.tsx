import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import { lazy, Suspense, useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { api } from '../lib/api'
import { StatusBadge } from '../components/StatusBadge'
import { formatTime, formatDateTime, formatDuration, formatLocalTime, formatTzShift } from '../lib/format'
import type { AircraftPosition, Flight, FlightWithEvents } from '../lib/api'
import { getAirport } from '../lib/airports'
import { useCountdown } from '../hooks/useCountdown'

const GlobeMap = lazy(() => import('../components/GlobeMap').then(m => ({ default: m.GlobeMap })))

// OOOI timeline step definitions
interface OooiStep {
  key: string
  label: string
  timeField: keyof FlightWithEvents | null
  description?: string
}

const OOOI_STEPS: OooiStep[] = [
  { key: 'scheduled',   label: 'Scheduled',    timeField: null },
  { key: 'boarding',    label: 'Boarding',      timeField: null },
  { key: 'off-gate',    label: 'Departed gate', timeField: 'departureActual' },
  { key: 'airborne',    label: 'Took off',      timeField: 'takeoffActual' },
  { key: 'en-route',    label: 'En route',      timeField: null },
  { key: 'touched-down',label: 'Landed',        timeField: 'landingActual' },
  { key: 'at-gate',     label: 'At gate',       timeField: 'arrivalActual' },
]

function getOooiStepIndex(status: string, flight: FlightWithEvents): number {
  const st = status.toLowerCase().replace(/[\s_]+/g, '-')
  if (st === 'arrived' || st === 'landed') {
    if (flight.arrivalActual) return 6
    if (flight.landingActual) return 5
    return 5
  }
  if (st === 'en-route') return 4
  if (st === 'departed') {
    if (flight.takeoffActual) return 4
    return 2
  }
  if (st === 'boarding') return 1
  return 0
}

function flightProgressPct(flight: FlightWithEvents): number {
  const dep = new Date(flight.departureActual ?? flight.departureScheduled).getTime()
  const arr = new Date(flight.arrivalEstimated ?? flight.arrivalScheduled).getTime()
  if (dep >= arr) return 0
  return Math.max(0, Math.min(100, ((Date.now() - dep) / (arr - dep)) * 100))
}

// ─── Sub-components ─────────────────────────────────────────────────────────

interface ProgressBarProps {
  flight: FlightWithEvents
}

function FlightProgressBar({ flight }: ProgressBarProps): React.ReactElement {
  const [pct, setPct] = useState(() => flightProgressPct(flight))
  const st = flight.status.toLowerCase().replace(/[\s_]+/g, '-')
  const isFlying = st === 'en-route' || st === 'departed'

  useEffect(() => {
    if (!isFlying) return
    const id = setInterval(() => setPct(flightProgressPct(flight)), 30_000)
    return () => clearInterval(id)
  }, [flight, isFlying])

  const displayPct = (st === 'landed' || st === 'arrived') ? 100 : isFlying ? pct : 0

  return (
    <div style={{ margin: '1.25rem 0' }}>
      <div className="progress-track">
        <div className="progress-dot-start" />
        <div className="progress-fill" style={{ width: `${displayPct}%` }} />
        {isFlying && (
          <div className="progress-plane" style={{ left: `${displayPct}%` }}>
            ✈
          </div>
        )}
        <div className="progress-dot-end" />
      </div>
    </div>
  )
}

interface TimeColProps {
  iata: string
  label: string
  scheduled: string
  estimated: string | null
  actual: string | null
  align: 'left' | 'right'
}

function TimeColumn({ iata, label, scheduled, estimated, actual, align }: TimeColProps): React.ReactElement {
  const best = actual ?? estimated ?? scheduled
  const hasChange = (estimated ?? actual) && (estimated ?? actual) !== scheduled
  const airport = getAirport(iata)
  const tz = airport?.tz
  const localTime = formatLocalTime(best, tz)
  const scheduledLocal = formatLocalTime(scheduled, tz)

  return (
    <div className={`time-col${align === 'right' ? ' right' : ''}`}>
      <div className="time-city">{airport?.city ?? iata}</div>
      <div className="time-iata">{iata}</div>
      <div className="time-main">{localTime}</div>
      {hasChange && (
        <div className="time-sched">{scheduledLocal}</div>
      )}
      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.1rem' }}>
        {label}
        {tz && (
          <span style={{ marginLeft: '0.3rem', opacity: 0.7 }}>
            {new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' })
              .formatToParts(new Date(best))
              .find(p => p.type === 'timeZoneName')?.value ?? ''}
          </span>
        )}
      </div>
    </div>
  )
}

// ─── Info cell icons ─────────────────────────────────────────────────────────

function IconDoorOpen(): React.ReactElement {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M13 4H3v16h10"/><path d="M13 4v16"/><path d="M21 4l-8 8 8 8"/><circle cx="16" cy="12" r="1" fill="currentColor"/>
    </svg>
  )
}

function IconBuilding2(): React.ReactElement {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z"/><path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"/><path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2"/><path d="M10 6h4"/><path d="M10 10h4"/><path d="M10 14h4"/><path d="M10 18h4"/>
    </svg>
  )
}

function IconLuggage(): React.ReactElement {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 20a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2Z"/><path d="M8 8V6a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="12" y1="12" x2="12" y2="16"/><line x1="10" y1="14" x2="14" y2="14"/>
    </svg>
  )
}

function IconPlane(): React.ReactElement {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.8 19.2 16 11l3.5-3.5C21 6 21 4 19 4c-2 0-4 0-5.5 1.5L10 9 1.8 6.2c-.5-.2-1 .1-1.1.6l-.2.8c-.1.5.2 1 .7 1.2L9 11l-3 5-4-1-.5.5 3 3 3-3 .5 3.5 8-3c.5.1 1-.2 1.2-.7l.1-.3c.1-.5-.2-1-.5-1.8z"/>
    </svg>
  )
}

function IconHash(): React.ReactElement {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/>
    </svg>
  )
}

function IconClock(): React.ReactElement {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
    </svg>
  )
}

function IconArmchair(): React.ReactElement {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 9V6a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v3"/><path d="M3 11v5a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5a2 2 0 0 0-4 0v2H7v-2a2 2 0 0 0-4 0Z"/><path d="M5 18v2"/><path d="M19 18v2"/>
    </svg>
  )
}

function IconTicket(): React.ReactElement {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"/><path d="M13 5v2"/><path d="M13 17v2"/><path d="M13 11v2"/>
    </svg>
  )
}

// ─── Connection Assistant ─────────────────────────────────────────────────────

function getConnectionRating(minutes: number): { label: string; color: string; bgColor: string } {
  if (minutes < 45) return { label: 'Risky',   color: 'var(--cancelled)', bgColor: 'rgba(248,113,113,0.12)' }
  if (minutes < 60) return { label: 'Tight',   color: '#FF9500',          bgColor: 'rgba(255,149,0,0.12)' }
  if (minutes < 90) return { label: 'Normal',  color: 'var(--accent-2)',  bgColor: 'var(--accent-2-dim)' }
  return               { label: 'Relaxed', color: 'var(--on-time)',  bgColor: 'rgba(52,211,153,0.12)' }
}

interface ConnectionInfo {
  layoverAirport: string
  inboundFlight: Flight
  outboundFlight: Flight
  effectiveMinutes: number
  inboundDelayMin: number
  rating: ReturnType<typeof getConnectionRating>
}

function buildConnections(currentFlight: FlightWithEvents, tripFlights: Flight[]): ConnectionInfo[] {
  const result: ConnectionInfo[] = []

  // Current flight is the OUTBOUND — find the inbound that delivered us to origin
  const inbound = tripFlights.find(f => f.id !== currentFlight.id && f.destination === currentFlight.origin)
  if (inbound) {
    const inboundArr   = new Date(inbound.arrivalActual ?? inbound.arrivalEstimated ?? inbound.arrivalScheduled).getTime()
    const outboundDep  = new Date(currentFlight.departureEstimated ?? currentFlight.departureScheduled).getTime()
    const effectiveMin = Math.round((outboundDep - inboundArr) / 60_000)
    const delayMin     = Math.round((inboundArr - new Date(inbound.arrivalScheduled).getTime()) / 60_000)
    result.push({ layoverAirport: currentFlight.origin, inboundFlight: inbound, outboundFlight: currentFlight, effectiveMinutes: effectiveMin, inboundDelayMin: Math.max(0, delayMin), rating: getConnectionRating(effectiveMin) })
  }

  // Current flight is the INBOUND — find the outbound waiting at destination
  const outbound = tripFlights.find(f => f.id !== currentFlight.id && f.origin === currentFlight.destination)
  if (outbound) {
    const inboundArr   = new Date(currentFlight.arrivalActual ?? currentFlight.arrivalEstimated ?? currentFlight.arrivalScheduled).getTime()
    const outboundDep  = new Date(outbound.departureEstimated ?? outbound.departureScheduled).getTime()
    const effectiveMin = Math.round((outboundDep - inboundArr) / 60_000)
    const delayMin     = Math.round((inboundArr - new Date(currentFlight.arrivalScheduled).getTime()) / 60_000)
    result.push({ layoverAirport: currentFlight.destination, inboundFlight: currentFlight, outboundFlight: outbound, effectiveMinutes: effectiveMin, inboundDelayMin: Math.max(0, delayMin), rating: getConnectionRating(effectiveMin) })
  }

  return result
}

function ConnectionCard({ flight }: { flight: FlightWithEvents }): React.ReactElement | null {
  const { data: trip } = useQuery({
    queryKey: ['trip', flight.tripId],
    queryFn: () => api.trips.get(flight.tripId!),
    enabled: !!flight.tripId,
    staleTime: 2 * 60_000,
  })

  if (!trip || trip.flights.length < 2) return null
  const connections = buildConnections(flight, trip.flights)
  if (connections.length === 0) return null

  return (
    <>
      {connections.map(conn => (
        <div key={`${conn.inboundFlight.id}-${conn.outboundFlight.id}`} className="card" style={{ marginBottom: '0.875rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.875rem' }}>
            <div style={{ fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.09em', color: 'var(--text-muted)' }}>
              Connection at {conn.layoverAirport}
            </div>
            <span style={{ fontSize: '0.78rem', fontWeight: 700, color: conn.rating.color, background: conn.rating.bgColor, borderRadius: 99, padding: '0.2rem 0.7rem', border: `1px solid ${conn.rating.color}44` }}>
              {conn.rating.label}
            </span>
          </div>
          <div style={{ display: 'flex', gap: '0.875rem', alignItems: 'center' }}>
            <div style={{ minWidth: 56, textAlign: 'center' }}>
              <div style={{ fontSize: '1.75rem', fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: conn.effectiveMinutes <= 0 ? 'var(--cancelled)' : conn.rating.color, lineHeight: 1 }}>
                {conn.effectiveMinutes <= 0 ? '0m' : `${conn.effectiveMinutes}m`}
              </div>
              <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>to connect</div>
            </div>
            <div style={{ flex: 1, borderLeft: '1px solid var(--hairline)', paddingLeft: '0.875rem', fontSize: '0.82rem' }}>
              <div style={{ fontWeight: 600, color: 'var(--text)', marginBottom: '0.2rem' }}>
                {conn.inboundFlight.ident} · {conn.inboundFlight.origin}–{conn.inboundFlight.destination}
              </div>
              {conn.inboundDelayMin > 5 ? (
                <div style={{ color: 'var(--delayed)' }}>Inbound {conn.inboundDelayMin}m late</div>
              ) : (
                <div style={{ color: 'var(--on-time)' }}>Inbound on time</div>
              )}
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                {conn.outboundFlight.ident} departs {formatTime(conn.outboundFlight.departureEstimated ?? conn.outboundFlight.departureScheduled)}
              </div>
            </div>
          </div>
        </div>
      ))}
    </>
  )
}

// ─── Share sheet ─────────────────────────────────────────────────────────────

interface ShareSheetProps {
  url: string
  flightId: string
  flightIdent: string
  onClose: () => void
}

function ShareSheet({ url, flightId, flightIdent, onClose }: ShareSheetProps): React.ReactElement {
  const queryClient = useQueryClient()
  const [copied, setCopied] = useState(false)
  const [revoking, setRevoking] = useState(false)

  // Close on Escape key
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  async function doCopy(): Promise<void> {
    await navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  async function handleNativeShare(): Promise<void> {
    if ('share' in navigator) {
      try {
        await (navigator as Navigator & { share: (d: object) => Promise<void> }).share({ title: `${flightIdent} · Flight Status`, text: 'Track my flight live', url })
        return
      } catch { /* user cancelled */ }
    }
    await doCopy()
  }

  async function handleRevoke(): Promise<void> {
    if (!window.confirm('Revoke share link? Anyone with the current link will lose access.')) return
    setRevoking(true)
    try {
      await api.flights.revokeShare(flightId)
      await queryClient.invalidateQueries({ queryKey: ['flight', flightId] })
      onClose()
    } catch {
      setRevoking(false)
    }
  }

  const hasNativeShare = 'share' in navigator

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 200,
        background: 'rgba(0,0,0,0.5)',
        backdropFilter: 'blur(4px)',
        WebkitBackdropFilter: 'blur(4px)' as React.CSSProperties['backdropFilter'],
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 380, damping: 38 }}
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--surface)',
          borderRadius: 16,
          padding: '1.5rem',
          width: 'min(90vw, 420px)',
          maxHeight: '80vh',
          overflowY: 'auto',
          boxShadow: '0 8px 40px rgba(0,0,0,0.5)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
          <div style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text)' }}>
            Share {flightIdent}
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '0.25rem', lineHeight: 1 }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
        <div style={{ background: 'var(--surface-raised)', borderRadius: 10, padding: '0.75rem', marginBottom: '1rem', fontSize: '0.78rem', fontFamily: 'monospace', color: 'var(--text-muted)', wordBreak: 'break-all' }}>
          {url}
        </div>
        <button
          onClick={() => void handleNativeShare()}
          style={{ display: 'block', width: '100%', padding: '0.875rem', marginBottom: '0.5rem', fontSize: '0.95rem', fontWeight: 600, borderRadius: 12, border: 'none', background: 'var(--accent)', color: '#000', cursor: 'pointer' }}
        >
          {hasNativeShare ? 'Share…' : copied ? '✓ Copied!' : 'Copy link'}
        </button>
        {hasNativeShare && (
          <button
            className="secondary"
            onClick={() => void doCopy()}
            style={{ display: 'block', width: '100%', padding: '0.875rem', marginBottom: '0.5rem', fontSize: '0.95rem', borderRadius: 12 }}
          >
            {copied ? '✓ Copied!' : 'Copy link'}
          </button>
        )}
        <button
          onClick={() => void handleRevoke()}
          disabled={revoking}
          style={{ display: 'block', width: '100%', padding: '0.875rem', fontSize: '0.875rem', borderRadius: 12, background: 'transparent', border: '1px solid rgba(248,113,113,0.3)', color: 'var(--cancelled)', cursor: 'pointer' }}
        >
          {revoking ? 'Revoking…' : 'Revoke link'}
        </button>
      </motion.div>
    </motion.div>
  )
}

// ─── Editable booking card ────────────────────────────────────────────────────

interface BookingCardProps {
  flightId: string
  seat: string | null
  confirmationCode: string | null
}

function BookingCard({ flightId, seat, confirmationCode }: BookingCardProps): React.ReactElement {
  const queryClient = useQueryClient()
  const [editSeat, setEditSeat] = useState(false)
  const [editConf, setEditConf] = useState(false)
  const [seatVal, setSeatVal] = useState(seat ?? '')
  const [confVal, setConfVal] = useState(confirmationCode ?? '')

  const mutation = useMutation({
    mutationFn: (data: { seat?: string | null; confirmationCode?: string | null }) =>
      api.flights.patch(flightId, data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['flight', flightId] })
    },
  })

  async function saveSeat(): Promise<void> {
    await mutation.mutateAsync({ seat: seatVal.trim() || null })
    setEditSeat(false)
  }

  async function saveConf(): Promise<void> {
    await mutation.mutateAsync({ confirmationCode: confVal.trim() || null })
    setEditConf(false)
  }

  return (
    <div className="card" style={{ marginBottom: '0.875rem' }}>
      <div style={{ fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.09em', color: 'var(--text-muted)', marginBottom: '0.875rem' }}>
        Your Trip
      </div>

      {/* Seat */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-muted)' }}>
          <IconArmchair />
          <span style={{ fontSize: '0.85rem', fontWeight: 500, color: 'var(--text)' }}>Seat</span>
        </div>
        {editSeat ? (
          <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
            <input
              value={seatVal}
              onChange={e => setSeatVal(e.target.value)}
              placeholder="e.g. 14A"
              autoFocus
              style={{ width: 90, padding: '0.3rem 0.5rem', fontSize: '0.85rem' }}
              onKeyDown={e => { if (e.key === 'Enter') void saveSeat() }}
            />
            <button
              style={{ padding: '0.3rem 0.65rem', fontSize: '0.78rem' }}
              onClick={() => void saveSeat()}
              disabled={mutation.isPending}
            >
              Save
            </button>
            <button className="secondary" style={{ padding: '0.3rem 0.65rem', fontSize: '0.78rem' }} onClick={() => { setEditSeat(false); setSeatVal(seat ?? '') }}>
              Cancel
            </button>
          </div>
        ) : (
          <button
            className="secondary"
            style={{ padding: '0.3rem 0.75rem', fontSize: '0.8rem', fontVariantNumeric: 'tabular-nums' }}
            onClick={() => setEditSeat(true)}
          >
            {seat ? seat : <span style={{ color: 'var(--accent)', fontWeight: 500 }}>+ Add seat</span>}
          </button>
        )}
      </div>

      {/* Confirmation code */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-muted)' }}>
          <IconTicket />
          <span style={{ fontSize: '0.85rem', fontWeight: 500, color: 'var(--text)' }}>Confirmation</span>
        </div>
        {editConf ? (
          <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
            <input
              value={confVal}
              onChange={e => setConfVal(e.target.value)}
              placeholder="e.g. ABC123"
              autoFocus
              style={{ width: 110, padding: '0.3rem 0.5rem', fontSize: '0.85rem' }}
              onKeyDown={e => { if (e.key === 'Enter') void saveConf() }}
            />
            <button
              style={{ padding: '0.3rem 0.65rem', fontSize: '0.78rem' }}
              onClick={() => void saveConf()}
              disabled={mutation.isPending}
            >
              Save
            </button>
            <button className="secondary" style={{ padding: '0.3rem 0.65rem', fontSize: '0.78rem' }} onClick={() => { setEditConf(false); setConfVal(confirmationCode ?? '') }}>
              Cancel
            </button>
          </div>
        ) : (
          <button
            className="secondary"
            style={{ padding: '0.3rem 0.75rem', fontSize: '0.8rem', fontFamily: 'monospace', letterSpacing: '0.06em' }}
            onClick={() => setEditConf(true)}
          >
            {confirmationCode ? confirmationCode : <span style={{ color: 'var(--accent)', fontWeight: 500, fontFamily: 'inherit', letterSpacing: 'normal' }}>+ Add confirmation</span>}
          </button>
        )}
      </div>
    </div>
  )
}

// ─── Aircraft photo card ──────────────────────────────────────────────────────

function AircraftPhotoCard({ flightId }: { flightId: string }): React.ReactElement | null {
  const { data: photo } = useQuery({
    queryKey: ['flight-photo', flightId],
    queryFn: () => api.flights.getPhoto(flightId),
    staleTime: 10 * 60 * 1000,
  })

  if (!photo) return null

  return (
    <div className="card" style={{ marginBottom: '0.875rem', padding: 0, overflow: 'hidden' }}>
      <img
        src={photo.url}
        alt="Aircraft photo"
        style={{ width: '100%', display: 'block', borderRadius: '16px 16px 0 0', maxHeight: 220, objectFit: 'cover' }}
        loading="lazy"
      />
      <div style={{ padding: '0.6rem 1rem', display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
        <span>
          &copy; {photo.photographer} · <a href={photo.link} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)' }}>planespotters.net</a>
        </span>
      </div>
    </div>
  )
}

// ─── OOOI Timeline ────────────────────────────────────────────────────────────

function OooiTimeline({ flight }: { flight: FlightWithEvents }): React.ReactElement {
  const currentIdx = getOooiStepIndex(flight.status, flight)

  return (
    <div className="card" style={{ marginBottom: '0.875rem' }}>
      <div style={{ fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.09em', color: 'var(--text-muted)', marginBottom: '1rem' }}>
        Status
      </div>
      <div className="event-timeline">
        {OOOI_STEPS.map((step, i) => {
          const done = i < currentIdx
          const active = i === currentIdx
          const timeStr = step.timeField
            ? formatTime(flight[step.timeField] as string | null)
            : null
          const showTime = done && timeStr && timeStr !== '--:--'

          return (
            <div key={step.key} className="event-item">
              <div className={`event-dot${done ? ' done' : active ? ' active' : ''}`} />
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem', justifyContent: 'space-between' }}>
                <div
                  className="event-label"
                  style={{
                    color: done
                      ? 'var(--on-time)'
                      : active
                        ? 'var(--accent)'
                        : 'var(--text-muted)',
                    fontWeight: active ? 700 : done ? 600 : 500,
                  }}
                >
                  {step.label}
                </div>
                {showTime && (
                  <div className="event-time" style={{ color: 'var(--on-time)' }}>
                    {timeStr}
                  </div>
                )}
              </div>
            </div>
          )
        })}
        {flight.baggageClaim && (
          <div className="event-item">
            <div className="event-dot done" />
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem', justifyContent: 'space-between' }}>
              <div className="event-label" style={{ color: 'var(--on-time)', fontWeight: 600 }}>
                Baggage claim
              </div>
              <div className="event-time" style={{ color: 'var(--on-time)' }}>
                {flight.baggageClaim}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function FlightDetailPage(): React.ReactElement {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [shareSheet, setShareSheet] = useState<{ url: string } | null>(null)
  const [sharing, setSharing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [position, setPosition] = useState<AircraftPosition | null>(null)
  const [globeExpanded, setGlobeExpanded] = useState(false)

  const { data: flight, isLoading } = useQuery({
    queryKey: ['flight', id],
    queryFn: () => api.flights.get(id!),
    refetchInterval: 60_000,
  })

  // Poll live position every 30s
  useEffect(() => {
    if (!id) return
    const poll = async (): Promise<void> => {
      try {
        const pos = await api.flights.position(id)
        setPosition(pos)
      } catch { /* not airborne */ }
    }
    void poll()
    const iv = setInterval(() => void poll(), 30_000)
    return () => clearInterval(iv)
  }, [id])

  // Countdown hook MUST run unconditionally before any early return (Rules of
  // Hooks). It tolerates an undefined flight while the query is loading.
  const countdown = useCountdown(flight)

  if (isLoading) return (
    <div className="loading" style={{ paddingTop: '4rem' }}>
      <div className="loading-spinner" />
      Loading flight…
    </div>
  )
  if (!flight) return <div className="error-box">Flight not found</div>

  const st = flight.status.toLowerCase().replace(/[\s_]+/g, '-')
  const isLive = st === 'en-route' || st === 'departed'

  // Flight duration
  const durationMs = (() => {
    if (flight.landingActual && flight.takeoffActual) {
      return new Date(flight.landingActual).getTime() - new Date(flight.takeoffActual).getTime()
    }
    return new Date(flight.arrivalScheduled).getTime() - new Date(flight.departureScheduled).getTime()
  })()

  // Timezone shift badge
  const originAirport = getAirport(flight.origin)
  const destAirport = getAirport(flight.destination)
  const tzShift = formatTzShift(
    originAirport?.tz,
    destAirport?.tz,
    flight.departureScheduled,
    destAirport?.city ?? flight.destination,
  )

  async function handleDelete(): Promise<void> {
    // Uses an in-app confirm (below), NOT window.confirm — browsers can suppress
    // native dialogs after repeated prompts, which silently broke deletion.
    setDeleting(true)
    try {
      await api.flights.delete(id!)
      // Drop it from every cached list immediately so it can't reappear.
      queryClient.setQueriesData<unknown[]>({ queryKey: ['flights'] }, (old) =>
        Array.isArray(old) ? old.filter((f) => (f as { id?: string })?.id !== id) : old
      )
      await queryClient.invalidateQueries({ queryKey: ['flights'] })
      navigate('/today')
    } catch (err) {
      setDeleting(false)
      setConfirmDelete(false)
      alert(err instanceof Error ? err.message : 'Could not delete this flight')
    }
  }

  async function handleShare(): Promise<void> {
    if (sharing) return
    setSharing(true)
    try {
      const res = await api.flights.share(id!)
      const full = res.url.startsWith('/') ? `${window.location.origin}${res.url}` : res.url
      setShareSheet({ url: full })
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Could not create share link')
    } finally {
      setSharing(false)
    }
  }

  return (
    <>
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.25 }}
    >
      {/* Globe hero — full bleed */}
      <div
        className="globe-hero globe-hero-top-safe"
        style={{
          height: globeExpanded ? '75vh' : undefined,
          maxHeight: globeExpanded ? '620px' : undefined,
          transition: 'height 0.35s cubic-bezier(0.4,0,0.2,1), max-height 0.35s cubic-bezier(0.4,0,0.2,1)',
        }}
      >
        <Suspense fallback={<div style={{ width: '100%', height: '100%', background: '#05080f' }} />}>
          <GlobeMap
            origin={flight.origin}
            destination={flight.destination}
            position={position}
            departureScheduled={flight.departureScheduled}
            arrivalScheduled={flight.arrivalScheduled}
            status={flight.status}
            expanded={globeExpanded}
            onExpandToggle={() => setGlobeExpanded(v => !v)}
          />
        </Suspense>

        {/* Back button overlay */}
        <button
          onClick={() => navigate(-1)}
          style={{
            position: 'absolute',
            top: 'calc(env(safe-area-inset-top, 0px) + 0.75rem)',
            left: '1rem',
            zIndex: 10,
            background: 'rgba(13,19,32,0.7)',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
            border: '1px solid var(--hairline)',
            borderRadius: '999px',
            padding: '0.4rem 0.875rem',
            fontSize: '0.85rem',
            color: 'var(--text)',
            display: 'flex',
            alignItems: 'center',
            gap: '0.3rem',
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Back
        </button>

        {/* Live badge overlay */}
        {isLive && (
          <div style={{
            position: 'absolute',
            top: 'calc(env(safe-area-inset-top, 0px) + 0.75rem)',
            right: '1rem',
            zIndex: 10,
            background: 'var(--accent-2-dim)',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
            border: '1px solid rgba(78,201,214,0.3)',
            borderRadius: '999px',
            padding: '0.35rem 0.75rem',
            fontSize: '0.72rem',
            fontWeight: 700,
            letterSpacing: '0.08em',
            color: 'var(--accent-2)',
            display: 'flex',
            alignItems: 'center',
            gap: '0.35rem',
          }}>
            <span className="badge-live-dot" style={{ margin: 0, boxShadow: '0 0 4px var(--accent-2)' }} />
            LIVE
          </div>
        )}
      </div>

      {/* Content sheet */}
      <div className="content-sheet">

        {/* Route header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.75rem', marginBottom: '0.625rem' }}>
          <div>
            <div className="detail-route">
              <span>{flight.origin}</span>
              <span className="detail-route-sep">›</span>
              <span>{flight.destination}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.3rem' }}>
              <StatusBadge status={flight.status} />
              <span style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>
                {flight.ident}
                {flight.aircraftType ? ` · ${flight.aircraftType}` : ''}
              </span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '0.4rem', flexShrink: 0 }}>
            {confirmDelete ? (
              <>
                <button className="secondary" style={{ padding: '0.45rem 0.75rem', fontSize: '0.8rem' }} onClick={() => setConfirmDelete(false)} disabled={deleting}>
                  Cancel
                </button>
                <button className="danger" style={{ padding: '0.45rem 0.75rem', fontSize: '0.8rem', whiteSpace: 'nowrap' }} onClick={() => void handleDelete()} disabled={deleting}>
                  {deleting ? 'Deleting…' : 'Confirm delete'}
                </button>
              </>
            ) : (
              <>
                <button className="secondary" style={{ padding: '0.45rem 0.75rem', fontSize: '0.8rem' }} onClick={() => void handleShare()} disabled={sharing}>
                  {sharing ? 'Sharing…' : 'Share'}
                </button>
                <button className="danger" style={{ padding: '0.45rem 0.75rem', fontSize: '0.8rem' }} onClick={() => setConfirmDelete(true)}>
                  Delete
                </button>
              </>
            )}
          </div>
        </div>

        {/* Prominent live countdown */}
        <div style={{ marginBottom: '1rem' }}>
          <div style={{
            fontSize: '1.55rem',
            fontWeight: 800,
            fontVariantNumeric: 'tabular-nums',
            letterSpacing: '-0.02em',
            color: st === 'cancelled' ? 'var(--cancelled)' : st === 'arrived' || st === 'landed' ? 'var(--on-time)' : 'var(--accent)',
            lineHeight: 1.15,
          }}>
            {countdown}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', marginTop: '0.3rem', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
              <IconClock />
              Flight time {formatDuration(durationMs)}
            </span>
            {tzShift && (
              <span style={{
                fontSize: '0.72rem',
                fontWeight: 600,
                background: 'var(--accent-2-dim)',
                border: '1px solid rgba(78,201,214,0.2)',
                borderRadius: 99,
                padding: '0.18rem 0.55rem',
                color: 'var(--accent-2)',
                letterSpacing: '0.02em',
              }}>
                {tzShift}
              </span>
            )}
          </div>
        </div>

        {/* Aircraft photo (async, non-blocking) */}
        <Suspense fallback={null}>
          <AircraftPhotoCard flightId={id!} />
        </Suspense>

        {/* Time columns + progress */}
        <div className="card" style={{ marginBottom: '0.875rem' }}>
          <div className="time-columns">
            <TimeColumn
              iata={flight.origin}
              label="Departure"
              scheduled={flight.departureScheduled}
              estimated={flight.departureEstimated}
              actual={flight.departureActual}
              align="left"
            />
            <div className="time-col-mid">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" opacity="0.4">
                <line x1="5" y1="12" x2="19" y2="12" />
                <polyline points="12 5 19 12 12 19" />
              </svg>
            </div>
            <TimeColumn
              iata={flight.destination}
              label="Arrival"
              scheduled={flight.arrivalScheduled}
              estimated={flight.arrivalEstimated}
              actual={flight.arrivalActual}
              align="right"
            />
          </div>

          <FlightProgressBar flight={flight} />
        </div>

        {/* OOOI Status timeline */}
        <OooiTimeline flight={flight} />

        {/* Connection Assistant — shown when flight is part of a trip with connecting legs */}
        <ConnectionCard flight={flight} />

        {/* Booking card */}
        <BookingCard
          flightId={id!}
          seat={flight.seat}
          confirmationCode={flight.confirmationCode}
        />

        {/* Info grid */}
        <div className="info-grid">
          {flight.gateDeparture && (
            <div className="info-cell">
              <div className="info-cell-label" style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                <IconDoorOpen /> Dep Gate
              </div>
              <div className="info-cell-value">{flight.gateDeparture}</div>
            </div>
          )}
          {flight.gateArrival && (
            <div className="info-cell">
              <div className="info-cell-label" style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                <IconDoorOpen /> Arr Gate
              </div>
              <div className="info-cell-value">{flight.gateArrival}</div>
            </div>
          )}
          {flight.terminalDeparture && (
            <div className="info-cell">
              <div className="info-cell-label" style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                <IconBuilding2 /> Dep Terminal
              </div>
              <div className="info-cell-value">{flight.terminalDeparture}</div>
            </div>
          )}
          {flight.terminalArrival && (
            <div className="info-cell">
              <div className="info-cell-label" style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                <IconBuilding2 /> Arr Terminal
              </div>
              <div className="info-cell-value">{flight.terminalArrival}</div>
            </div>
          )}
          {flight.baggageClaim && (
            <div className="info-cell">
              <div className="info-cell-label" style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                <IconLuggage /> Baggage
              </div>
              <div className="info-cell-value">{flight.baggageClaim}</div>
            </div>
          )}
          {flight.aircraftType && (
            <div className="info-cell">
              <div className="info-cell-label" style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                <IconPlane /> Aircraft
              </div>
              <div className="info-cell-value">{flight.aircraftType}</div>
            </div>
          )}
          {flight.registration && (
            <div className="info-cell">
              <div className="info-cell-label" style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                <IconHash /> Registration
              </div>
              <div className="info-cell-value" style={{ fontFamily: 'monospace', fontSize: '0.9rem' }}>{flight.registration}</div>
            </div>
          )}
          <div className="info-cell">
            <div className="info-cell-label" style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
              <IconClock /> Duration
            </div>
            <div className="info-cell-value">{formatDuration(durationMs)}</div>
          </div>
        </div>

        {/* Event history */}
        {flight.events.length > 0 && (
          <div className="card" style={{ marginTop: '0.875rem', marginBottom: '1rem' }}>
            <div style={{ fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.09em', color: 'var(--text-muted)', marginBottom: '1rem' }}>
              Updates
            </div>
            {flight.events.map((ev, i) => (
              <div key={ev.id} style={{
                display: 'flex',
                justifyContent: 'space-between',
                padding: '0.5rem 0',
                borderBottom: i < flight.events.length - 1 ? '1px solid var(--hairline)' : 'none',
              }}>
                <div>
                  <span style={{ fontSize: '0.85rem', textTransform: 'capitalize', fontWeight: 500 }}>
                    {ev.eventType.replace(/_/g, ' ')}
                  </span>
                  {ev.oldValue && ev.newValue && (
                    <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginLeft: '0.5rem' }}>
                      {ev.oldValue} → {ev.newValue}
                    </span>
                  )}
                </div>
                <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums', flexShrink: 0, marginLeft: '0.75rem' }}>
                  {formatDateTime(ev.occurredAt)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </motion.div>

    <AnimatePresence>
      {shareSheet && (
        <ShareSheet
          url={shareSheet.url}
          flightId={id!}
          flightIdent={flight.ident}
          onClose={() => setShareSheet(null)}
        />
      )}
    </AnimatePresence>
    </>
  )
}
