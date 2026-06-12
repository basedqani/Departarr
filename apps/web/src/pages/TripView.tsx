import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import { FlightCard } from '../components/FlightCard'
import { formatDate } from '../lib/format'

export function TripViewPage(): React.ReactElement {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const { data: trip, isLoading } = useQuery({
    queryKey: ['trip', id],
    queryFn: () => api.trips.get(id!),
  })

  if (isLoading) return <div className="loading">Loading…</div>
  if (!trip) return <div className="error-box">Trip not found</div>

  async function handleDelete(): Promise<void> {
    if (!confirm('Delete this trip? Flights will be kept but unassigned.')) return
    await api.trips.delete(id!)
    await queryClient.invalidateQueries({ queryKey: ['trips'] })
    navigate('/upcoming')
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>{trip.name}</h1>
          {trip.startDate && (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginTop: '0.25rem' }}>
              {formatDate(trip.startDate)}{trip.endDate ? ` – ${formatDate(trip.endDate)}` : ''}
            </p>
          )}
        </div>
        <button className="danger" onClick={() => void handleDelete()}>Delete</button>
      </div>

      {trip.flights.length === 0 && (
        <div className="empty">
          <h3>No flights in this trip</h3>
          <p>Add flights and assign them to this trip</p>
        </div>
      )}

      {trip.flights.map(f => (
        <FlightCard key={f.id} flight={f} showDate />
      ))}
    </>
  )
}
