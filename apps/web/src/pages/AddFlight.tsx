import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient, useQuery } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import { api, type FlightPreview } from '../lib/api'
import { getAirport } from '../lib/airports'
import { formatTime } from '../lib/format'
import { StatusBadge } from '../components/StatusBadge'

export function AddFlightPage(): React.ReactElement {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [ident, setIdent] = useState('')
  const [date, setDate] = useState(new Date().toISOString().substring(0, 10))
  const [tripId, setTripId] = useState('')
  const [error, setError] = useState('')
  const [looking, setLooking] = useState(false)
  const [adding, setAdding] = useState(false)
  const [preview, setPreview] = useState<FlightPreview | null>(null)

  const { data: trips } = useQuery({ queryKey: ['trips'], queryFn: api.trips.list })

  async function handleLookup(e: FormEvent): Promise<void> {
    e.preventDefault()
    setError('')
    setLooking(true)
    try {
      const result = await api.flights.lookup(ident.toUpperCase().replace(/\s+/g, ''), date)
      setPreview(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not find that flight')
    } finally {
      setLooking(false)
    }
  }

  async function handleConfirmAdd(): Promise<void> {
    setError('')
    setAdding(true)
    try {
      const flight = await api.flights.add({
        ident: ident.toUpperCase().replace(/\s+/g, ''),
        date,
        tripId: tripId || undefined,
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

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22 }}>
      <div className="page-header">
        <h1>Add Flight</h1>
      </div>

      {error && <div className="error-box" style={{ maxWidth: 480 }}>{error}</div>}

      <AnimatePresence mode="wait">
        {!preview ? (
          /* ── Step 1: look up ── */
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
        ) : (
          /* ── Step 2: confirm ── */
          <motion.div
            key="preview"
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
                  <div className="info-cell-value">{formatTime(preview.departureEstimated ?? preview.departureScheduled)}</div>
                </div>
                <div className="info-cell">
                  <div className="info-cell-label">Arrival</div>
                  <div className="info-cell-value">{formatTime(preview.arrivalEstimated ?? preview.arrivalScheduled)}</div>
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
              <button type="button" className="secondary" onClick={() => { setPreview(null); setError('') }} disabled={adding}>
                Search again
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}
