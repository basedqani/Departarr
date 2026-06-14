import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient, useQuery } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import { api, type FlightPreview } from '../lib/api'
import { getAirport } from '../lib/airports'
import { formatLocalTime, getAirportTz } from '../lib/format'
import { StatusBadge } from '../components/StatusBadge'

type Step = 'form' | 'pick-leg' | 'confirm'

export function AddFlightPage(): React.ReactElement {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [ident, setIdent] = useState('')
  const [date, setDate] = useState(new Date().toISOString().substring(0, 10))
  const [tripId, setTripId] = useState('')
  const [error, setError] = useState('')
  const [looking, setLooking] = useState(false)
  const [adding, setAdding] = useState(false)
  const [step, setStep] = useState<Step>('form')
  const [legs, setLegs] = useState<FlightPreview[]>([])
  const [preview, setPreview] = useState<FlightPreview | null>(null)

  const { data: trips } = useQuery({ queryKey: ['trips'], queryFn: api.trips.list })

  async function handleLookup(e: FormEvent): Promise<void> {
    e.preventDefault()
    setError('')
    setLooking(true)
    try {
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
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not find that flight')
    } finally {
      setLooking(false)
    }
  }

  function handlePickLeg(leg: FlightPreview): void {
    setPreview(leg)
    setStep('confirm')
  }

  async function handleConfirmAdd(): Promise<void> {
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
        <h1>Add Flight</h1>
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
                  <label>Flight number</label>
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
                  ) : 'Look up flight'}
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

        {step === 'confirm' && preview && (
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
