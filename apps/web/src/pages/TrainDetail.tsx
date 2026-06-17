import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { api } from '../lib/api'
import type { TrainStop, WeatherResult } from '../lib/api'
import { StatusBadge } from '../components/StatusBadge'
import { formatDuration, formatDate, formatTimeInZone, getAmtrakStationTz } from '../lib/format'
import { TrainMap } from '../components/TrainMap'
import type { GtfsStop } from '../components/TrainMap'
import { AddToTripDialog } from '../components/AddToTripDialog'

// fmtTime is used for stop timelines and events where we pass the timezone explicitly
function fmtTime(iso: string | null | undefined, tz: string | null): string {
  if (!iso) return '--:--'
  return formatTimeInZone(iso, tz)
}

// ─── Weather helpers (mirrored from FlightDetail) ─────────────────────────────

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

function WeatherSection({ weather, tz }: { weather: WeatherResult; tz: string | null }): React.ReactElement | null {
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
          <span className="weather-time">{fmtTime(w.time, tz)}</span>
        </div>
      </div>
    </section>
  )
}

// ─── Share dialog ────────────────────────────────────────────────────────────

interface TrainShareSheetProps {
  url: string
  trainId: string
  trainLabel: string
  onClose: () => void
}

function TrainShareSheet({ url, trainId, trainLabel, onClose }: TrainShareSheetProps): React.ReactElement {
  const queryClient = useQueryClient()
  const [copied, setCopied] = useState(false)
  const [revoking, setRevoking] = useState(false)

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
        await (navigator as Navigator & { share: (d: object) => Promise<void> }).share({ title: `${trainLabel} · Train Status`, text: 'Track my train live', url })
        return
      } catch { /* user cancelled */ }
    }
    await doCopy()
  }

  async function handleRevoke(): Promise<void> {
    if (!window.confirm('Revoke share link? Anyone with the current link will lose access.')) return
    setRevoking(true)
    try {
      await api.trains.revokeShare(trainId)
      await queryClient.invalidateQueries({ queryKey: ['train', trainId] })
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
          boxShadow: '0 8px 40px rgba(0,0,0,0.5)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
          <div style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text)' }}>
            Share {trainLabel}
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

// ─── Booking card ─────────────────────────────────────────────────────────────

function BookingCard({ trainId, seat, confirmationCode }: { trainId: string; seat: string | null; confirmationCode: string | null }): React.ReactElement {
  const queryClient = useQueryClient()
  const [editSeat, setEditSeat] = useState(false)
  const [editConf, setEditConf] = useState(false)
  const [seatVal, setSeatVal] = useState(seat ?? '')
  const [confVal, setConfVal] = useState(confirmationCode ?? '')

  const mutation = useMutation({
    mutationFn: (data: { seat?: string | null; confirmationCode?: string | null }) =>
      api.trains.patch(trainId, data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['train', trainId] })
    },
  })

  return (
    <div className="card" style={{ marginBottom: '0.875rem' }}>
      <div style={{ fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.09em', color: 'var(--text-muted)', marginBottom: '0.875rem' }}>
        Your Booking
      </div>

      {/* Seat */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
        <span style={{ fontSize: '0.85rem', fontWeight: 500, color: 'var(--text)' }}>Seat</span>
        {editSeat ? (
          <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
            <input value={seatVal} onChange={e => setSeatVal(e.target.value)} placeholder="e.g. 14" autoFocus style={{ width: 90, padding: '0.3rem 0.5rem', fontSize: '0.85rem' }} onKeyDown={e => { if (e.key === 'Enter') { mutation.mutate({ seat: seatVal.trim() || null }); setEditSeat(false) } }} />
            <button style={{ padding: '0.3rem 0.65rem', fontSize: '0.78rem' }} onClick={() => { mutation.mutate({ seat: seatVal.trim() || null }); setEditSeat(false) }} disabled={mutation.isPending}>Save</button>
            <button className="secondary" style={{ padding: '0.3rem 0.65rem', fontSize: '0.78rem' }} onClick={() => { setEditSeat(false); setSeatVal(seat ?? '') }}>Cancel</button>
          </div>
        ) : (
          <button className="secondary" style={{ padding: '0.3rem 0.75rem', fontSize: '0.8rem' }} onClick={() => setEditSeat(true)}>
            {seat ?? <span style={{ color: 'var(--accent)', fontWeight: 500 }}>+ Add seat</span>}
          </button>
        )}
      </div>

      {/* Confirmation code */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: '0.85rem', fontWeight: 500, color: 'var(--text)' }}>Confirmation</span>
        {editConf ? (
          <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
            <input value={confVal} onChange={e => setConfVal(e.target.value)} placeholder="e.g. ABC123" autoFocus style={{ width: 110, padding: '0.3rem 0.5rem', fontSize: '0.85rem' }} onKeyDown={e => { if (e.key === 'Enter') { mutation.mutate({ confirmationCode: confVal.trim() || null }); setEditConf(false) } }} />
            <button style={{ padding: '0.3rem 0.65rem', fontSize: '0.78rem' }} onClick={() => { mutation.mutate({ confirmationCode: confVal.trim() || null }); setEditConf(false) }} disabled={mutation.isPending}>Save</button>
            <button className="secondary" style={{ padding: '0.3rem 0.65rem', fontSize: '0.78rem' }} onClick={() => { setEditConf(false); setConfVal(confirmationCode ?? '') }}>Cancel</button>
          </div>
        ) : (
          <button className="secondary" style={{ padding: '0.3rem 0.75rem', fontSize: '0.8rem', fontFamily: 'monospace', letterSpacing: '0.06em' }} onClick={() => setEditConf(true)}>
            {confirmationCode ?? <span style={{ color: 'var(--accent)', fontWeight: 500, fontFamily: 'inherit', letterSpacing: 'normal' }}>+ Add confirmation</span>}
          </button>
        )}
      </div>
    </div>
  )
}

// ─── Stop timeline ────────────────────────────────────────────────────────────

function StopTimeline({ stops, originTz }: { stops: TrainStop[]; originTz: string | null }): React.ReactElement {
  return (
    <div className="card" style={{ marginBottom: '0.875rem' }}>
      <div style={{ fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.09em', color: 'var(--text-muted)', marginBottom: '1rem' }}>
        Station Progress
      </div>
      <div className="event-timeline">
        {stops.map((stop, i) => {
          const passed = !!(stop.dep ?? stop.arr)
          const isCurrent = !passed && i > 0 && !!(stops[i - 1]?.dep ?? stops[i - 1]?.arr)
          const schTime = stop.schDep ?? stop.schArr
          const actTime = stop.dep ?? stop.arr
          const delayComment = stop.depCmnt ?? stop.arrCmnt
          // Each stop ideally has its own timezone; fall back to origin tz
          const stopTz = getAmtrakStationTz(stop.code) ?? originTz

          let dotClass = ''
          if (passed) dotClass = ' done'
          else if (isCurrent) dotClass = ' active'

          return (
            <div key={`${stop.code}-${i}`} className="event-item">
              <div className={`event-dot${dotClass}`} />
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flex: 1 }}>
                <div>
                  <div
                    className="event-label"
                    style={{
                      color: passed ? 'var(--on-time)' : isCurrent ? 'var(--accent)' : 'var(--text-muted)',
                      fontWeight: isCurrent ? 700 : passed ? 600 : 500,
                    }}
                  >
                    <span style={{ fontFamily: 'var(--font-mono)', marginRight: '0.4rem' }}>{stop.code}</span>
                    {stop.name}
                  </div>
                  {delayComment && (
                    <div style={{ fontSize: '0.68rem', color: '#fbbf24', marginTop: '0.1rem' }}>
                      {delayComment}
                    </div>
                  )}
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0, paddingLeft: '0.5rem' }}>
                  {actTime && (
                    <div className="event-time" style={{ color: passed ? 'var(--on-time)' : 'var(--text)' }}>
                      {fmtTime(actTime, stopTz)}
                    </div>
                  )}
                  {!actTime && schTime && (
                    <div className="event-time" style={{ color: 'var(--text-muted)' }}>
                      {schTime.substring(0, 5)}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function TrainDetailPage(): React.ReactElement {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [shareSheet, setShareSheet] = useState<{ url: string } | null>(null)
  const [sharing, setSharing] = useState(false)
  const [addToTripOpen, setAddToTripOpen] = useState(false)

  const { data: train, isLoading } = useQuery({
    queryKey: ['train', id],
    queryFn: () => api.trains.get(id!),
    refetchInterval: 60_000,
  })

  const tempUnit = (localStorage.getItem('tempUnit') as 'F' | 'C') ?? 'F'
  const { data: weather } = useQuery({
    queryKey: ['train-weather', id, tempUnit],
    queryFn: () => api.trains.weather(id!, tempUnit),
    enabled: !!train,
    staleTime: 30 * 60_000,
    retry: false,
  })

  if (isLoading) return (
    <div className="loading" style={{ paddingTop: '4rem' }}>
      <div className="loading-spinner" />
      Loading train…
    </div>
  )
  if (!train) return <div className="error-box">Train not found</div>

  const stops: TrainStop[] = (() => {
    try { return JSON.parse(train.stopsJson ?? '[]') as TrainStop[] }
    catch { return [] }
  })()

  const gtfsStops: GtfsStop[] = (() => {
    try { return JSON.parse(train.stopsJson ?? '[]') as GtfsStop[] }
    catch { return [] }
  })()

  const originTz = getAmtrakStationTz(train.origin)
  const destTz = getAmtrakStationTz(train.destination)
  const depTime = fmtTime(train.departureActual ?? train.departureEstimated ?? train.departureScheduled, originTz)
  const arrTime = fmtTime(train.arrivalActual ?? train.arrivalEstimated ?? train.arrivalScheduled, destTz)
  const durationMs = new Date(train.arrivalScheduled).getTime() - new Date(train.departureScheduled).getTime()

  async function handleDelete(): Promise<void> {
    setDeleting(true)
    try {
      await api.trains.delete(id!)
      queryClient.setQueriesData<unknown[]>({ queryKey: ['trains'] }, (old) =>
        Array.isArray(old) ? old.filter((t) => (t as { id?: string })?.id !== id) : old
      )
      await queryClient.invalidateQueries({ queryKey: ['trains'] })
      navigate('/today')
    } catch (err) {
      setDeleting(false)
      setConfirmDelete(false)
      alert(err instanceof Error ? err.message : 'Could not delete this train')
    }
  }

  const formatEventLabel = (eventType: string, oldValue: string | null, newValue: string | null): string => {
    switch (eventType) {
      case 'delay': {
        const oldT = oldValue ? fmtTime(oldValue, originTz) : null
        const newT = newValue ? fmtTime(newValue, originTz) : null
        if (oldT && newT) return `Departure delayed: ${oldT} → ${newT}`
        if (newT) return `Departure updated to ${newT}`
        return 'Departure time changed'
      }
      case 'status_change':
        return newValue ? `Status: ${newValue.replace(/_/g, ' ')}` : 'Status updated'
      case 'cancellation':
        return 'Train cancelled'
      case 'arrival':
        return newValue ? `Arrived at ${newValue}` : 'Arrived'
      case 'departure':
        return newValue ? `Departed at ${newValue}` : 'Departed'
      default:
        return eventType.replace(/_/g, ' ')
    }
  }

  return (
    <>
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.25 }}
    >
      <div className="content-sheet">
        {/* Back button + header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
          <button
            onClick={() => navigate(-1)}
            className="secondary"
            style={{ padding: '0.4rem 0.75rem', fontSize: '0.85rem', flexShrink: 0 }}
          >
            ←
          </button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="detail-route" style={{ fontSize: '1.5rem' }}>
              <span>{train.origin}</span>
              <span className="detail-route-sep">›</span>
              <span>{train.destination}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.25rem', flexWrap: 'wrap' }}>
              <StatusBadge status={train.status} />
              <span style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>
                Train {train.trainNumber}{train.trainName ? ` · ${train.trainName}` : ''}
              </span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '0.4rem', flexShrink: 0 }}>
            {!confirmDelete && (
              <button
                className="secondary"
                style={{ padding: '0.45rem 0.75rem', fontSize: '0.8rem' }}
                onClick={() => setAddToTripOpen(true)}
              >
                Trip
              </button>
            )}
            {!confirmDelete && (
              <button
                className="secondary"
                style={{ padding: '0.45rem 0.75rem', fontSize: '0.8rem' }}
                disabled={sharing}
                onClick={async () => {
                  if (sharing) return
                  setSharing(true)
                  try {
                    const res = await api.trains.share(id!)
                    const full = res.url.startsWith('/') ? `${window.location.origin}${res.url}` : res.url
                    setShareSheet({ url: full })
                  } catch (err) {
                    alert(err instanceof Error ? err.message : 'Could not create share link')
                  } finally {
                    setSharing(false)
                  }
                }}
              >
                {sharing ? '…' : 'Share'}
              </button>
            )}
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
              <button className="danger" style={{ padding: '0.45rem 0.75rem', fontSize: '0.8rem' }} onClick={() => setConfirmDelete(true)}>
                Delete
              </button>
            )}
          </div>
        </div>

        {/* Times card */}
        <div className="card" style={{ marginBottom: '0.875rem' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '1rem' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '0.68rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)' }}>Departs</div>
              <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 800, fontSize: '1.6rem', lineHeight: 1, color: 'var(--accent)', marginTop: '0.15rem' }}>{depTime}</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>{train.originName ?? train.origin}</div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{formatDate(train.departureScheduled)}</div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', paddingTop: '1.2rem', color: 'var(--text-muted)', fontSize: '0.72rem', gap: '0.25rem' }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" opacity="0.4">
                <line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" />
              </svg>
              <span>{formatDuration(durationMs)}</span>
            </div>
            <div style={{ flex: 1, textAlign: 'right' }}>
              <div style={{ fontSize: '0.68rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)' }}>Arrives</div>
              <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 800, fontSize: '1.6rem', lineHeight: 1, color: 'var(--text)', marginTop: '0.15rem' }}>{arrTime}</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>{train.destinationName ?? train.destination}</div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{formatDate(train.arrivalScheduled)}</div>
            </div>
          </div>
        </div>

        {/* Booking card */}
        <BookingCard trainId={id!} seat={train.seat} confirmationCode={train.confirmationCode} />

        {/* Train route map */}
        {gtfsStops.length >= 2 && gtfsStops[0].lat !== 0 && (
          <TrainMap
            stops={gtfsStops}
            departureScheduled={train.departureScheduled}
            status={train.status}
            origin={train.origin}
            destination={train.destination}
          />
        )}

        {/* Stop timeline */}
        {stops.length > 0 && <StopTimeline stops={stops} originTz={originTz} />}

        {/* Weather at destination */}
        {weather && <WeatherSection weather={weather} tz={destTz} />}

        {/* Event history */}
        {train.events.length > 0 && (
          <div className="card" style={{ marginBottom: '1rem' }}>
            <div style={{ fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.09em', color: 'var(--text-muted)', marginBottom: '1rem' }}>
              Updates
            </div>
            {train.events.map((ev, i) => {
              const label = formatEventLabel(ev.eventType, ev.oldValue, ev.newValue)
              return (
                <div key={ev.id} style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                  gap: '0.75rem',
                  padding: '0.55rem 0',
                  borderBottom: i < train.events.length - 1 ? '1px solid var(--hairline)' : 'none',
                }}>
                  <span style={{ fontSize: '0.875rem', lineHeight: 1.4 }}>{label}</span>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums', flexShrink: 0, paddingTop: '0.1rem' }}>
                    {fmtTime(ev.occurredAt, originTz)}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </motion.div>

    <AnimatePresence>
      {shareSheet && (
        <TrainShareSheet
          url={shareSheet.url}
          trainId={id!}
          trainLabel={`Train ${train.trainNumber}${train.trainName ? ` · ${train.trainName}` : ''}`}
          onClose={() => setShareSheet(null)}
        />
      )}
    </AnimatePresence>
    <AnimatePresence>
      {addToTripOpen && (
        <AddToTripDialog
          itemId={id!}
          itemType="train"
          currentTripId={train.tripId}
          onClose={() => setAddToTripOpen(false)}
        />
      )}
    </AnimatePresence>
    </>
  )
}
