import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient, useQuery } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { api } from '../lib/api'

export function AddFlightPage(): React.ReactElement {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [ident, setIdent] = useState('')
  const [date, setDate] = useState(new Date().toISOString().substring(0, 10))
  const [tripId, setTripId] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const { data: trips } = useQuery({
    queryKey: ['trips'],
    queryFn: api.trips.list,
  })

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault()
    setError('')
    setLoading(true)
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
    } finally {
      setLoading(false)
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22 }}
    >
      <div className="page-header">
        <h1>Add Flight</h1>
      </div>

      <div className="card" style={{ maxWidth: 480 }}>
        {error && <div className="error-box">{error}</div>}

        <form onSubmit={(e) => void handleSubmit(e)}>
          <div className="form-row">
            <div className="form-group">
              <label>Flight number</label>
              <input
                type="text"
                value={ident}
                onChange={e => setIdent(e.target.value.toUpperCase())}
                placeholder="e.g. DL123"
                required
                autoCapitalize="characters"
                style={{ textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, fontSize: '1.05rem' }}
              />
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
                Airline code + number, e.g. <span style={{ fontFamily: 'monospace', color: 'var(--accent)' }}>BA178</span>, <span style={{ fontFamily: 'monospace', color: 'var(--accent)' }}>UA88</span>, <span style={{ fontFamily: 'monospace', color: 'var(--accent)' }}>NH7</span>
              </div>
            </div>
            <div className="form-group">
              <label>Date</label>
              <input
                type="date"
                value={date}
                onChange={e => setDate(e.target.value)}
                required
              />
            </div>
          </div>

          {trips && trips.length > 0 && (
            <div className="form-group">
              <label>Trip (optional)</label>
              <select value={tripId} onChange={e => setTripId(e.target.value)}>
                <option value="">No trip</option>
                {trips.map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
          )}

          <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem' }}>
            <button
              type="submit"
              disabled={loading}
              style={{ flex: 1, padding: '0.75rem', position: 'relative' }}
            >
              {loading ? (
                <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
                  <span className="loading-spinner" style={{ width: 16, height: 16 }} />
                  Looking up…
                </span>
              ) : 'Add flight'}
            </button>
            <button type="button" className="secondary" onClick={() => navigate(-1)}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    </motion.div>
  )
}
