import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient, useQuery } from '@tanstack/react-query'
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
    <>
      <div className="page-header">
        <h1>Add Flight</h1>
      </div>

      <div className="card">
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
                style={{ textTransform: 'uppercase', letterSpacing: '0.05em' }}
              />
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
            <button type="submit" disabled={loading}>
              {loading ? 'Looking up…' : 'Add flight'}
            </button>
            <button type="button" className="secondary" onClick={() => navigate(-1)}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    </>
  )
}
