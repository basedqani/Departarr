import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient, useQuery } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import { api, type FlightPreview, type TrainPreview } from '../lib/api'
import { getAirport } from '../lib/airports'
import { formatLocalTime, getAirportTz } from '../lib/format'
import { StatusBadge } from '../components/StatusBadge'

type Step = 'form' | 'pick-leg' | 'confirm'
type AddMode = 'flight' | 'train'

function PlaneIcon(): React.ReactElement {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
      <path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z" />
    </svg>
  )
}

function TrainIconBtn(): React.ReactElement {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="3" width="16" height="13" rx="2" />
      <path d="M4 11h16" />
      <path d="M12 3v8" />
      <path d="M8 19l-2 3" />
      <path d="M18 22l-2-3" />
      <path d="M7 19h10" />
    </svg>
  )
}

export function AddFlightPage(): React.ReactElement {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [mode, setMode] = useState<AddMode>('flight')
  const [ident, setIdent] = useState('')
  const [date, setDate] = useState(new Date().toISOString().substring(0, 10))
  const [tripId, setTripId] = useState('')
  const [error, setError] = useState('')
  const [looking, setLooking] = useState(false)
  const [adding, setAdding] = useState(false)
  const [step, setStep] = useState<Step>('form')
  const [legs, setLegs] = useState<FlightPreview[]>([])
  const [preview, setPreview] = useState<FlightPreview | null>(null)
  const [trainPreview, setTrainPreview] = useState<TrainPreview | null>(null)

  const { data: trips } = useQuery({ queryKey: ['trips'], queryFn: api.trips.list })

  async function handleLookup(e: FormEvent): Promise<void> {
    e.preventDefault()
    setError('')
    setLooking(true)
    try {
      if (mode === 'train') {
        const tp = await api.trains.lookup(ident.trim(), date)
        setTrainPreview(tp)
        setStep('confirm')
      } else {
        const clean = ident.toUpperCase().replace(/\s+/g, '')
        const results = await api.flights.lookupAll(clean, date)
        if (results.length === 1) {
          setPreview(results[0])
          setStep('confirm')
        } else {
          // Sort legs by departure time, closest to now first
          const now = Date.now()
          const sorted = [...results].sort((a, b) => {
            const aTime = new Date(a.departureEstimated ?? a.departureScheduled).getTime()
            const bTime = new Date(b.departureEstimated ?? b.departureScheduled).getTime()
            return Math.abs(aTime - now) - Math.abs(bTime - now)
          })
          setLegs(sorted)
          setStep('pick-leg')
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : mode === 'train' ? 'Could not find that train' : 'Could not find that flight')
    } finally {
      setLooking(false)
    }
  }

  function handlePickLeg(leg: FlightPreview): void {
    setPreview(leg)
    setStep('confirm')
  }

  async function handleConfirmAdd(): Promise<void> {
    if (mode === 'train') {
      if (!trainPreview) return
      setError('')
      setAdding(true)
      try {
        const train = await api.trains.add({
          trainNumber: ident.trim(),
          date,
          tripId: tripId || undefined,
          origin: trainPreview.origin,
          destination: trainPreview.destination,
        })
        await queryClient.invalidateQueries({ queryKey: ['trains'] })
        navigate(`/trains/${train.id}`)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to add train')
        setAdding(false)
      }
      return
    }

    if (!preview) return
    setError('')
    setAdding(true)
    try {
      const flight = await api.flights.add({
        ident: ident.toUpperCase().replace(/\s+/g, ''),
        date,
        tripId: tripId || undefined,
        origin: preview.origin,
        dest: preview.destination,
      })
      await queryClient.invalidateQueries({ queryKey: ['flights'] })
      navigate(`/flights/${flight.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add flight')
      setAdding(false)
    }
  }

  const originAirport = preview ? getAirport(preview.origin) : null
  const destAirport = preview ? getAirport(preview.destination) : null
  const originTz = preview ? getAirportTz(preview.origin) : undefined
  const destTz = preview ? getAirportTz(preview.destination) : undefined

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22 }}>
      <div className="page-header">
        <h1>Add {mode === 'train' ? 'Train' : 'Flight'}</h1>
      </div>

      {/* Mode toggle */}
      <div className="mode-toggle">
        <button
          type="button"
          className={`mode-btn${mode === 'flight' ? ' active' : ''}`}
          onClick={() => { setMode('flight'); setStep('form'); setError(''); setIdent(''); setPreview(null); setTrainPreview(null) }}
        >
          <PlaneIcon /> Flight
        </button>
        <button
          type="button"
          className={`mode-btn${mode === 'train' ? ' active' : ''}`}
          onClick={() => { setMode('train'); setStep('form'); setError(''); setIdent(''); setPreview(null); setTrainPreview(null) }}
        >
          <TrainIconBtn /> Train
        </button>
      </div>

      {error && <div className="error-box" style={{ maxWidth: 480 }}>{error}</div>}

      <AnimatePresence mode="wait">
        {step === 'form' && (
          <motion.div
            key="form"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, x: -16 }}
            transition={{ duration: 0.18 }}
            className="card"
            style={{ maxWidth: 480 }}
          >
            <form onSubmit={(e) => void handleLookup(e)}>
              <div className="form-row">
                <div className="form-group">
                  <label>{mode === 'train' ? 'Train number' : 'Flight number'}</label>
                  {mode === 'train' ? (
                    <>
                      <input
                        type="text"
                        value={ident}
                        onChange={e => setIdent(e.target.value)}
                        placeholder="e.g. 351"
                        required
                        style={{ letterSpacing: '0.04em', fontWeight: 600, fontSize: '1.05rem' }}
                      />
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
                        Amtrak train number — e.g. <span style={{ fontFamily: 'monospace', color: 'var(--accent)' }}>351</span> (Wolverine), <span style={{ fontFamily: 'monospace', color: 'var(--accent)' }}>49</span> (Lake Shore Limited)
                      </div>
                    </>
                  ) : (
                    <>
                      <input
                        type="text"
                        value={ident}
                        onChange={e => setIdent(e.target.value.toUpperCase())}
                        placeholder="e.g. DL1533"
                        required
                        autoCapitalize="characters"
                        style={{ textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, fontSize: '1.05rem' }}
                      />
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
                        Airline code + number, e.g. <span style={{ fontFamily: 'monospace', color: 'var(--accent)' }}>BA178</span>, <span style={{ fontFamily: 'monospace', color: 'var(--accent)' }}>UA88</span>
                      </div>
                    </>
                  )}
                </div>
                <div className="form-group">
                  <label>Date</label>
                  <input type="date" value={date} onChange={e => setDate(e.target.value)} required />
                </div>
              </div>

              {trips && trips.length > 0 && (
                <div className="form-group">
                  <label>Trip (optional)</label>
                  <select value={tripId} onChange={e => setTripId(e.target.value)}>
                    <option value="">No trip</option>
                    {trips.map(t => (<option key={t.id} value={t.id}>{t.name}</option>))}
                  </select>
                </div>
              )}

              <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem' }}>
                <button type="submit" disabled={looking || !ident.trim()} style={{ flex: 1, padding: '0.75rem' }}>
                  {looking ? (
                    <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
                      <span className="loading-spinner" style={{ width: 16, height: 16 }} />
                      Looking up…
                    </span>
                  ) : mode === 'train' ? 'Look up train' : 'Look up flight'}
                </button>
                <button type="button" className="secondary" onClick={() => navigate(-1)}>Cancel</button>
              </div>
            </form>
          </motion.div>
        )}

        {step === 'pick-leg' && (
          <motion.div
            key="pick-leg"
            initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            style={{ maxWidth: 480 }}
          >
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '0.75rem' }}>
              <strong style={{ color: 'var(--text)' }}>{ident.toUpperCase()}</strong> operates {legs.length} legs on this date. Which one is yours?
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
              {legs.map((leg, i) => {
                const orig = getAirport(leg.origin)
                const dest = getAirport(leg.destination)
                const depTime = leg.departureEstimated ?? leg.departureScheduled
                const arrTime = leg.arrivalEstimated ?? leg.arrivalScheduled
                const originTz = getAirportTz(leg.origin)
                const isClosest = i === 0
                return (
                  <button
                    key={`${leg.origin}-${leg.destination}-${depTime}`}
                    onClick={() => handlePickLeg(leg)}
                    style={{
                      textAlign: 'left',
                      padding: '1rem 1.1rem',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '1rem',
                      background: 'var(--card-bg)',
                      border: isClosest
                        ? '1.5px solid var(--accent)'
                        : '1.5px solid var(--border)',
                      borderRadius: 'var(--radius)',
                      cursor: 'pointer',
                      width: '100%',
                      transition: 'border-color 0.15s, box-shadow 0.15s',
                    }}
                  >
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                        <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: '1.05rem', letterSpacing: '0.05em' }}>
                          {leg.origin}
                        </span>
                        <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>›</span>
                        <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: '1.05rem', letterSpacing: '0.05em' }}>
                          {leg.destination}
                        </span>
                        {isClosest && (
                          <span style={{
                            fontSize: '0.65rem',
                            fontWeight: 700,
                            letterSpacing: '0.05em',
                            color: 'var(--accent)',
                            background: 'color-mix(in srgb, var(--accent) 12%, transparent)',
                            padding: '0.15rem 0.45rem',
                            borderRadius: '999px',
                            textTransform: 'uppercase',
                          }}>
                            Closest
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                        {orig?.city ?? leg.origin} → {dest?.city ?? leg.destination}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: '1rem', fontFamily: 'monospace', letterSpacing: '0.04em' }}>
                        {formatLocalTime(depTime, originTz)}
                      </div>
                      {arrTime && (
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.1rem' }}>
                          → {formatLocalTime(arrTime, getAirportTz(leg.destination))}
                        </div>
                      )}
                      <div style={{ marginTop: '0.25rem' }}>
                        <StatusBadge status={leg.status} />
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
            <div style={{ marginTop: '1rem' }}>
              <button type="button" className="secondary" onClick={() => { setStep('form'); setError('') }}>
                ← Search again
              </button>
            </div>
          </motion.div>
        )}

        {step === 'confirm' && mode === 'train' && trainPreview && (
          <motion.div
            key="confirm-train"
            initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            style={{ maxWidth: 480 }}
          >
            <div className="card">
              <div style={{ marginBottom: '1rem' }}>
                <div className="detail-route" style={{ fontSize: '1.75rem' }}>
                  <span>{trainPreview.origin}</span>
                  <span className="detail-route-sep">›</span>
                  <span>{trainPreview.destination}</span>
                </div>
                <div style={{ color: 'var(--text-muted)', fontSize: '0.82rem', marginTop: '0.25rem' }}>
                  Train {trainPreview.trainNumber}{trainPreview.trainName ? ` · ${trainPreview.trainName}` : ''}
                </div>
                {(trainPreview.originName || trainPreview.destinationName) && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.5rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    <span>{trainPreview.originName ?? trainPreview.origin}</span>
                    <span>{trainPreview.destinationName ?? trainPreview.destination}</span>
                  </div>
                )}
              </div>

              <div className="info-grid" style={{ marginTop: 0 }}>
                <div className="info-cell">
                  <div className="info-cell-label">Departure</div>
                  <div className="info-cell-value">
                    {new Date(trainPreview.departureScheduled).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
                <div className="info-cell">
                  <div className="info-cell-label">Arrival</div>
                  <div className="info-cell-value">
                    {new Date(trainPreview.arrivalScheduled).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
              </div>

              {/* Show first 3 stops + last stop */}
              {trainPreview.stops.length > 0 && (
                <div style={{ marginTop: '1rem', borderTop: '1px dashed var(--hairline)', paddingTop: '0.75rem' }}>
                  <div style={{ fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', marginBottom: '0.4rem' }}>
                    Stops ({trainPreview.stops.length})
                  </div>
                  {trainPreview.stops.slice(0, 3).map((stop, i) => (
                    <div key={`${stop.code}-${i}`} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--text-muted)', padding: '0.15rem 0' }}>
                      <span><span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, marginRight: '0.4rem' }}>{stop.code}</span>{stop.name}</span>
                      {(stop.schDep ?? stop.schArr) && <span style={{ fontFamily: 'var(--font-mono)' }}>{(stop.schDep ?? stop.schArr)!.substring(0, 5)}</span>}
                    </div>
                  ))}
                  {trainPreview.stops.length > 3 && (
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', padding: '0.15rem 0', opacity: 0.7 }}>
                      … {trainPreview.stops.length - 4} more stops …
                    </div>
                  )}
                  {trainPreview.stops.length > 3 && (() => {
                    const last = trainPreview.stops[trainPreview.stops.length - 1]
                    return (
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--text-muted)', padding: '0.15rem 0' }}>
                        <span><span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, marginRight: '0.4rem' }}>{last.code}</span>{last.name}</span>
                        {(last.schDep ?? last.schArr) && <span style={{ fontFamily: 'var(--font-mono)' }}>{(last.schDep ?? last.schArr)!.substring(0, 5)}</span>}
                      </div>
                    )
                  })()}
                </div>
              )}
            </div>

            <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem' }}>
              <button onClick={() => void handleConfirmAdd()} disabled={adding} style={{ flex: 1, padding: '0.75rem', fontWeight: 600 }}>
                {adding ? (
                  <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
                    <span className="loading-spinner" style={{ width: 16, height: 16 }} />
                    Adding…
                  </span>
                ) : 'Add to my trains'}
              </button>
              <button type="button" className="secondary" onClick={() => { setStep('form'); setError('') }} disabled={adding}>
                ← Back
              </button>
            </div>
          </motion.div>
        )}

        {step === 'confirm' && mode === 'flight' && preview && (
          <motion.div
            key="confirm"
            initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            style={{ maxWidth: 480 }}
          >
            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
                <div>
                  <div className="detail-route" style={{ fontSize: '1.75rem' }}>
                    <span>{preview.origin}</span>
                    <span className="detail-route-sep">›</span>
                    <span>{preview.destination}</span>
                  </div>
                  <div style={{ color: 'var(--text-muted)', fontSize: '0.82rem', marginTop: '0.25rem' }}>
                    {ident.toUpperCase()}{preview.aircraftType ? ` · ${preview.aircraftType}` : ''}
                  </div>
                </div>
                <StatusBadge status={preview.status} />
              </div>

              {(originAirport || destAirport) && (
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem', gap: '0.5rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  <div>{originAirport?.city ?? preview.origin}</div>
                  <div style={{ textAlign: 'right' }}>{destAirport?.city ?? preview.destination}</div>
                </div>
              )}

              <div className="info-grid" style={{ marginTop: 0 }}>
                <div className="info-cell">
                  <div className="info-cell-label">Departure</div>
                  <div className="info-cell-value">{formatLocalTime(preview.departureEstimated ?? preview.departureScheduled, originTz)}</div>
                </div>
                <div className="info-cell">
                  <div className="info-cell-label">Arrival</div>
                  <div className="info-cell-value">{formatLocalTime(preview.arrivalEstimated ?? preview.arrivalScheduled, destTz)}</div>
                </div>
                {preview.gateDeparture && (
                  <div className="info-cell">
                    <div className="info-cell-label">Gate</div>
                    <div className="info-cell-value">{preview.gateDeparture}</div>
                  </div>
                )}
                {preview.terminalDeparture && (
                  <div className="info-cell">
                    <div className="info-cell-label">Terminal</div>
                    <div className="info-cell-value">{preview.terminalDeparture}</div>
                  </div>
                )}
              </div>
            </div>

            <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem' }}>
              <button onClick={() => void handleConfirmAdd()} disabled={adding} style={{ flex: 1, padding: '0.75rem', fontWeight: 600 }}>
                {adding ? (
                  <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
                    <span className="loading-spinner" style={{ width: 16, height: 16 }} />
                    Adding…
                  </span>
                ) : 'Add to my flights'}
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => { setStep(legs.length > 1 ? 'pick-leg' : 'form'); setError('') }}
                disabled={adding}
              >
                ← Back
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}
