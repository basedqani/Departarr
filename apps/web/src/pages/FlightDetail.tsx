import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import { lazy, Suspense, useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { api } from '../lib/api'
import { StatusBadge } from '../components/StatusBadge'
import { formatTime, formatDateTime, formatDuration, formatLocalTime, formatTzShift, getAirportTz } from '../lib/format'
import type { AircraftPosition, Flight, FlightWithEvents, WeatherResult } from '../lib/api'
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
  const airport = getAirport(iata)
  // Prefer airport DB timezone, fall back to static AIRPORT_TZ map
  const tz = airport?.tz ?? getAirportTz(iata)
  const localTime = formatLocalTime(best, tz)

  // Compute delay in minutes vs scheduled; only show badge if > 5 min
  const delayMin = (() => {
    const updated = actual ?? estimated
    if (!updated || !scheduled) return 0
    const diff = Math.round((new Date(updated).getTime() - new Date(scheduled).getTime()) / 60_000)
    return Math.abs(diff) > 5 ? diff : 0
  })()

  // Time label: "Actual", "Estimated", or "Scheduled"
  const timeTypeLabel = actual ? 'Actual' : estimated ? 'Estimated' : 'Scheduled'

  // Timezone abbreviation (CDT, JST, etc.)
  const tzAbbr = tz
    ? (new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' })
        .formatToParts(new Date(best))
        .find(p => p.type === 'timeZoneName')?.value ?? '')
    : ''

  return (
    <div className={`time-col${align === 'right' ? ' right' : ''}`}>
      <div className="time-city">{airport?.city ?? iata}</div>
      <div className="time-iata">{iata}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
        <div className="time-main">{localTime}</div>
        {delayMin !== 0 && (
          <span style={{
            fontSize: '0.68rem',
            fontWeight: 700,
            padding: '0.1rem 0.4rem',
            borderRadius: 4,
            background: 'rgba(251,191,36,0.15)',
            border: '1px solid rgba(251,191,36,0.4)',
            color: '#fbbf24',
            letterSpacing: '0.02em',
            whiteSpace: 'nowrap',
          }}>
            {delayMin > 0 ? `Delayed +${delayMin}m` : `Early ${delayMin}m`}
          </span>
        )}
      </div>
      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.1rem', display: 'flex', alignItems: 'center', gap: '0.3rem', flexWrap: 'wrap' }}>
        <span>{label}</span>
        <span style={{ opacity: 0.6 }}>·</span>
        <span style={{ opacity: 0.8 }}>{timeTypeLabel}</span>
        {tzAbbr && (
          <span style={{ opacity: 0.7 }}>{tzAbbr}</span>
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

// ─── Carbon footprint ────────────────────────────────────────────────────────

// Subset of IATA → [lat, lon] coords (mirrored from packages/api/src/data/airports.ts)
const AIRPORT_COORDS: Record<string, [number, number]> = {
  ATL: [33.6407, -84.4277], LAX: [33.9425, -118.4081], ORD: [41.9742, -87.9073],
  DFW: [32.8998, -97.0403], DEN: [39.8561, -104.6737], JFK: [40.6413, -73.7781],
  SFO: [37.6213, -122.379], SEA: [47.4502, -122.3088], LAS: [36.0840, -115.1537],
  MCO: [28.4312, -81.3081], EWR: [40.6895, -74.1745], PHX: [33.4373, -112.0078],
  IAH: [29.9902, -95.3368], MIA: [25.7959, -80.2870], BOS: [42.3656, -71.0096],
  MSP: [44.8848, -93.2223], DTW: [42.2124, -83.3534], CLT: [35.2140, -80.9431],
  PHL: [39.8729, -75.2437], LGA: [40.7773, -73.8726], BWI: [39.1754, -76.6682],
  SLC: [40.7884, -111.9778], DCA: [38.8512, -77.0402], MDW: [41.7868, -87.7522],
  SAN: [32.7336, -117.1897], TPA: [27.9755, -82.5332], PDX: [45.5898, -122.5951],
  HNL: [21.3245, -157.9251], STL: [38.7487, -90.3700], BNA: [36.1245, -86.6782],
  AUS: [30.1975, -97.6664], MCI: [39.2976, -94.7139], OAK: [37.7213, -122.2208],
  SJC: [37.3626, -121.9290], RDU: [35.8801, -78.7880], SMF: [38.6954, -121.5908],
  PIT: [40.4915, -80.2329], CVG: [39.0489, -84.6678], CLE: [41.4117, -81.8498],
  IND: [39.7173, -86.2944], CMH: [39.9980, -82.8919], MKE: [42.9472, -87.8966],
  MSY: [29.9934, -90.2580], RSW: [26.5362, -81.7552], JAX: [30.4941, -81.6879],
  BUF: [42.9405, -78.7322], ALB: [42.7483, -73.8017], ORF: [36.8976, -76.0183],
  LHR: [51.4775, -0.4614], CDG: [49.0097, 2.5479], AMS: [52.3086, 4.7639],
  FRA: [50.0379, 8.5622], MAD: [40.4983, -3.5676], BCN: [41.2974, 2.0833],
  FCO: [41.8003, 12.2389], MUC: [48.3538, 11.7861], ZRH: [47.4647, 8.5492],
  DXB: [25.2532, 55.3657], DOH: [25.2609, 51.6138], AUH: [24.4330, 54.6511],
  SIN: [1.3644, 103.9915], HKG: [22.3080, 113.9185], NRT: [35.7648, 140.3864],
  HND: [35.5493, 139.7798], ICN: [37.4602, 126.4407], PEK: [40.0799, 116.6031],
  PVG: [31.1443, 121.8083], SYD: [-33.9461, 151.1772], MEL: [-37.6733, 144.8430],
  BKK: [13.6811, 100.7475], KUL: [2.7456, 101.7099], DEL: [28.5665, 77.1031],
  BOM: [19.0896, 72.8656], YYZ: [43.6772, -79.6306], YVR: [49.1967, -123.1815],
  GRU: [-23.4356, -46.4731], EZE: [-34.8222, -58.5358], SCL: [-33.3930, -70.7858],
  LIM: [-12.0219, -77.1143], BOG: [-4.1698, -73.6690], MEX: [19.4363, -99.0721],
  CUN: [21.0365, -86.8771], GDL: [20.5218, -103.3110],
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function computeCarbonKg(origin: string, destination: string): number | null {
  const o = AIRPORT_COORDS[origin]
  const d = AIRPORT_COORDS[destination]
  if (!o || !d) return null
  const km = haversineKm(o[0], o[1], d[0], d[1])
  const factor = km < 1500 ? 0.255 : km < 4000 ? 0.195 : 0.147
  return Math.round(km * factor)
}

function formatCarbon(kg: number): string {
  if (kg >= 1000) return `~${(kg / 1000).toFixed(1)}t CO₂`
  return `~${kg} kg CO₂`
}

function CarbonSection({ origin, destination }: { origin: string; destination: string }): React.ReactElement | null {
  const kg = computeCarbonKg(origin, destination)
  if (kg === null) return null
  return (
    <section className="weather-section" style={{ marginTop: '0.875rem' }}>
      <div style={{ fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.09em', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
        Carbon footprint
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
        <span style={{ fontSize: '1.35rem', lineHeight: 1 }}>♻</span>
        <div>
          <div style={{ fontSize: '1.15rem', fontWeight: 700, color: 'var(--text)', lineHeight: 1.2 }}>
            {formatCarbon(kg)}
          </div>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
            Economy class estimate
          </div>
        </div>
      </div>
    </section>
  )
}

// ─── Weather helpers ──────────────────────────────────────────────────────────

function weatherLabel(code: number): string {
  if (code === 0) return 'Clear'
  if (code <= 3) return 'Cloudy'
  if (code <= 9) return 'Foggy'
  if (code <= 29) return 'Drizzle'
  if (code <= 39) return 'Snow'
  if (code <= 49) return 'Fog'
  if (code <= 59) return 'Drizzle'
  if (code <= 69) return 'Rain'
  if (code <= 79) return 'Snow'
  if (code <= 84) return 'Showers'
  if (code <= 94) return 'Thunderstorm'
  return 'Storm'
}

function weatherEmoji(code: number): string {
  if (code === 0) return '☀️'
  if (code <= 3) return '⛅'
  if (code <= 49) return '🌫'
  if (code <= 69) return '🌧'
  if (code <= 79) return '❄️'
  if (code <= 84) return '🌦'
  return '⛈'
}

function WeatherSection({ weather }: { weather: WeatherResult }): React.ReactElement | null {
  const tempUnit = (localStorage.getItem('tempUnit') as 'F' | 'C') ?? 'F'
  const w = weather.weather[0]
  if (!w) return null
  return (
    <section className="weather-section">
      <div style={{ fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.09em', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
        Weather at {weather.airport}
      </div>
      <div className="weather-slots">
        <div className="weather-slot">
          <span className="weather-emoji">{weatherEmoji(w.code)}</span>
          <span className="weather-temp">{Math.round(w.temp)}°{tempUnit}</span>
          <span className="weather-label">{weatherLabel(w.code)}</span>
          <span className="weather-wind">{Math.round(w.wind)} km/h</span>
          <span className="weather-time">{new Date(w.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
        </div>
      </div>
    </section>
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

  const tempUnit = (localStorage.getItem('tempUnit') as 'F' | 'C') ?? 'F'
  const { data: weather } = useQuery({
    queryKey: ['weather', flight?.id, tempUnit],
    queryFn: () => api.flights.weather(flight!.id, tempUnit),
    enabled: !!flight?.destination && (!!flight?.arrivalScheduled || !!flight?.arrivalEstimated || !!flight?.arrivalActual),
    staleTime: 30 * 60 * 1000,
    retry: false,
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

        {/* Weather at destination */}
        {weather && <WeatherSection weather={weather} />}

        {/* Carbon footprint estimate */}
        <CarbonSection origin={flight.origin} destination={flight.destination} />

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
