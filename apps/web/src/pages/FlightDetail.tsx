import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { lazy, Suspense, useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { api } from '../lib/api'
import { StatusBadge } from '../components/StatusBadge'
import { formatTime, formatDateTime } from '../lib/format'
import type { AircraftPosition, FlightWithEvents } from '../lib/api'
import { getAirport } from '../lib/airports'

const GlobeMap = lazy(() => import('../components/GlobeMap').then(m => ({ default: m.GlobeMap })))

const STATUS_STEPS = [
  { key: 'scheduled',  label: 'Scheduled' },
  { key: 'boarding',   label: 'Boarding' },
  { key: 'departed',   label: 'Departed' },
  { key: 'en-route',   label: 'En Route' },
  { key: 'landed',     label: 'Landed' },
  { key: 'arrived',    label: 'Arrived' },
]

function getStepIndex(status: string): number {
  const idx = STATUS_STEPS.findIndex(s => s.key === status.toLowerCase().replace(/[\s_]+/g, '-'))
  return idx === -1 ? 0 : idx
}

function flightProgressPct(flight: FlightWithEvents): number {
  const dep = new Date(flight.departureActual ?? flight.departureScheduled).getTime()
  const arr = new Date(flight.arrivalEstimated ?? flight.arrivalScheduled).getTime()
  if (dep >= arr) return 0
  return Math.max(0, Math.min(100, ((Date.now() - dep) / (arr - dep)) * 100))
}

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

  return (
    <div className={`time-col${align === 'right' ? ' right' : ''}`}>
      <div className="time-city">{airport?.city ?? iata}</div>
      <div className="time-iata">{iata}</div>
      <div className="time-main">{formatTime(best)}</div>
      {hasChange && (
        <div className="time-sched">{formatTime(scheduled)}</div>
      )}
      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.1rem' }}>
        {label}
      </div>
    </div>
  )
}

export function FlightDetailPage(): React.ReactElement {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [shareUrl, setShareUrl] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [position, setPosition] = useState<AircraftPosition | null>(null)

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

  if (isLoading) return (
    <div className="loading" style={{ paddingTop: '4rem' }}>
      <div className="loading-spinner" />
      Loading flight…
    </div>
  )
  if (!flight) return <div className="error-box">Flight not found</div>

  const stepIdx = getStepIndex(flight.status)
  const st = flight.status.toLowerCase().replace(/[\s_]+/g, '-')
  const isLive = st === 'en-route' || st === 'departed'

  async function handleDelete(): Promise<void> {
    if (!confirm('Delete this flight?')) return
    setDeleting(true)
    try {
      await api.flights.delete(id!)
      await queryClient.invalidateQueries({ queryKey: ['flights'] })
      navigate(-1)
    } catch { setDeleting(false) }
  }

  async function handleShare(): Promise<void> {
    try {
      const res = await api.flights.share(id!)
      setShareUrl(res.url)
    } catch { /* noop */ }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.25 }}
    >
      {/* Globe hero — full bleed */}
      <div className="globe-hero globe-hero-top-safe">
        <Suspense fallback={<div style={{ width: '100%', height: '100%', background: '#05080f' }} />}>
          <GlobeMap
            origin={flight.origin}
            destination={flight.destination}
            position={position}
            departureScheduled={flight.departureScheduled}
            arrivalScheduled={flight.arrivalScheduled}
            status={flight.status}
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
            background: 'rgba(77,168,255,0.15)',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
            border: '1px solid rgba(77,168,255,0.3)',
            borderRadius: '999px',
            padding: '0.35rem 0.75rem',
            fontSize: '0.72rem',
            fontWeight: 700,
            letterSpacing: '0.08em',
            color: 'var(--accent)',
            display: 'flex',
            alignItems: 'center',
            gap: '0.35rem',
          }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)', display: 'inline-block', boxShadow: '0 0 4px var(--accent)' }} />
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
            <button className="secondary" style={{ padding: '0.45rem 0.75rem', fontSize: '0.8rem' }} onClick={() => void handleShare()}>
              Share
            </button>
            <button className="danger" style={{ padding: '0.45rem 0.75rem', fontSize: '0.8rem' }} onClick={() => void handleDelete()} disabled={deleting}>
              Delete
            </button>
          </div>
        </div>

        {shareUrl && (
          <div className="card" style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.75rem 1rem' }}>
            <span style={{ flex: 1, fontSize: '0.82rem', wordBreak: 'break-all', color: 'var(--text-muted)' }}>{shareUrl}</span>
            <button className="secondary" style={{ whiteSpace: 'nowrap', padding: '0.35rem 0.75rem', fontSize: '0.8rem' }} onClick={() => { void navigator.clipboard.writeText(shareUrl) }}>
              Copy
            </button>
          </div>
        )}

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

        {/* Status steps */}
        <div className="card" style={{ marginBottom: '0.875rem' }}>
          <div style={{ fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.09em', color: 'var(--text-muted)', marginBottom: '1rem' }}>
            Status
          </div>
          <div className="event-timeline">
            {STATUS_STEPS.map((step, i) => {
              const done = i < stepIdx
              const active = i === stepIdx
              return (
                <div key={step.key} className="event-item">
                  <div className={`event-dot${done ? ' done' : active ? ' active' : ''}`} />
                  <div className="event-label">{step.label}</div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Info grid */}
        <div className="info-grid">
          {flight.gateDeparture && (
            <div className="info-cell">
              <div className="info-cell-label">Dep Gate</div>
              <div className="info-cell-value">{flight.gateDeparture}</div>
            </div>
          )}
          {flight.gateArrival && (
            <div className="info-cell">
              <div className="info-cell-label">Arr Gate</div>
              <div className="info-cell-value">{flight.gateArrival}</div>
            </div>
          )}
          {flight.terminalDeparture && (
            <div className="info-cell">
              <div className="info-cell-label">Dep Terminal</div>
              <div className="info-cell-value">{flight.terminalDeparture}</div>
            </div>
          )}
          {flight.terminalArrival && (
            <div className="info-cell">
              <div className="info-cell-label">Arr Terminal</div>
              <div className="info-cell-value">{flight.terminalArrival}</div>
            </div>
          )}
          {flight.baggageClaim && (
            <div className="info-cell">
              <div className="info-cell-label">Baggage</div>
              <div className="info-cell-value">{flight.baggageClaim}</div>
            </div>
          )}
          {flight.aircraftType && (
            <div className="info-cell">
              <div className="info-cell-label">Aircraft</div>
              <div className="info-cell-value">{flight.aircraftType}</div>
            </div>
          )}
          {flight.registration && (
            <div className="info-cell">
              <div className="info-cell-label">Registration</div>
              <div className="info-cell-value">{flight.registration}</div>
            </div>
          )}
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
  )
}
