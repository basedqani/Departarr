import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { api } from '../lib/api'
import { FlightCard } from '../components/FlightCard'
import { TrainCard } from '../components/TrainCard'
import { ConnectionBadge } from '../components/ConnectionBadge'
import { TripCard } from '../components/TripCard'
import { buildDisplayItems, formatLayover, type DisplayItem, type InlineConnection } from '../lib/tripGrouping'
import { formatDate } from '../lib/format'

function daysUntil(dateStr: string): number {
  const dep = new Date(dateStr)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  dep.setHours(0, 0, 0, 0)
  return Math.round((dep.getTime() - today.getTime()) / 86_400_000)
}

function countdownLabel(dateStr: string): string {
  const d = daysUntil(dateStr)
  if (d === 0) return 'Today'
  if (d === 1) return 'Tomorrow'
  if (d > 0) return `in ${d} days`
  return 'Past'
}

function getItemDateKey(item: DisplayItem): string {
  if (item.type === 'trip' || item.type === 'auto-itinerary') {
    return item.legs[0].data.departureScheduled.substring(0, 10)
  }
  if (item.type === 'standalone-train') {
    return item.train.departureScheduled.substring(0, 10)
  }
  return item.flight.departureScheduled.substring(0, 10)
}

function getItemFirstDeparture(item: DisplayItem): string {
  if (item.type === 'trip' || item.type === 'auto-itinerary') return item.legs[0].data.departureScheduled
  if (item.type === 'standalone-train') return item.train.departureScheduled
  return item.flight.departureScheduled
}

// ─── Inline connection badge ──────────────────────────────────────────────────

function InlineConnectionBadge({ conn, showGreen = false }: { conn: InlineConnection; showGreen?: boolean }): React.ReactElement | null {
  if (conn.risk === 'green' && !showGreen) return null
  const palettes = {
    red:    { bg: 'rgba(229,62,62,0.10)',  border: 'rgba(229,62,62,0.35)',  color: '#e53e3e', icon: '⚠', label: '— AT RISK' },
    yellow: { bg: 'rgba(214,158,46,0.10)', border: 'rgba(214,158,46,0.35)', color: '#d69e2e', icon: '⏱', label: '— Tight'   },
    green:  { bg: 'rgba(56,161,105,0.06)', border: 'rgba(56,161,105,0.20)', color: '#38a169', icon: '✓', label: ''          },
  }
  const p = palettes[conn.risk]
  return (
    <div style={{
      margin: '0 0 0.5rem',
      padding: '0.4rem 0.875rem',
      borderRadius: 8,
      background: p.bg,
      border: `1px solid ${p.border}`,
      color: p.color,
      fontSize: '0.78rem',
      fontWeight: 600,
      display: 'flex',
      alignItems: 'center',
      gap: '0.4rem',
    }}>
      {p.icon} {formatLayover(conn.layoverMinutes)} layover · {conn.airport}{p.label ? ` ${p.label}` : ''}
      {conn.sameTerminal && (
        <span style={{ fontSize: '0.7rem', fontWeight: 400, opacity: 0.75 }}>· same terminal</span>
      )}
    </div>
  )
}

// ─── New Trip dialog ──────────────────────────────────────────────────────────

function NewTripDialog({ onClose }: { onClose: () => void }): React.ReactElement {
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleCreate(): Promise<void> {
    const trimmed = name.trim()
    if (!trimmed) return
    setSaving(true)
    setError(null)
    try {
      await api.trips.create({
        name: trimmed,
        ...(startDate ? { startDate } : {}),
        ...(endDate ? { endDate } : {}),
      })
      await queryClient.invalidateQueries({ queryKey: ['trips'] })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create trip')
      setSaving(false)
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
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
        initial={{ scale: 0.95, opacity: 0, y: 12 }} animate={{ scale: 1, opacity: 1, y: 0 }} exit={{ scale: 0.95, opacity: 0 }}
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
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
          <div style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text)' }}>New Trip</div>
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

        <div style={{ marginBottom: '1rem' }}>
          <label style={{ fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', display: 'block', marginBottom: '0.4rem' }}>
            Trip name
          </label>
          <input
            autoFocus
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="e.g. Tokyo 2025"
            onKeyDown={e => { if (e.key === 'Enter') void handleCreate() }}
            style={{ width: '100%', padding: '0.6rem 0.75rem', fontSize: '0.95rem', borderRadius: 8, boxSizing: 'border-box' }}
          />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '1.25rem' }}>
          <div>
            <label style={{ fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', display: 'block', marginBottom: '0.4rem' }}>
              Start date
            </label>
            <input
              type="date"
              value={startDate}
              onChange={e => setStartDate(e.target.value)}
              style={{ width: '100%', padding: '0.55rem 0.6rem', fontSize: '0.875rem', borderRadius: 8, boxSizing: 'border-box' }}
            />
          </div>
          <div>
            <label style={{ fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', display: 'block', marginBottom: '0.4rem' }}>
              End date
            </label>
            <input
              type="date"
              value={endDate}
              onChange={e => setEndDate(e.target.value)}
              style={{ width: '100%', padding: '0.55rem 0.6rem', fontSize: '0.875rem', borderRadius: 8, boxSizing: 'border-box' }}
            />
          </div>
        </div>

        {error && (
          <div style={{ color: 'var(--cancelled)', fontSize: '0.82rem', marginBottom: '0.75rem' }}>{error}</div>
        )}

        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button
            onClick={() => void handleCreate()}
            disabled={saving || !name.trim()}
            style={{ flex: 1, padding: '0.75rem', fontSize: '0.9rem', fontWeight: 600, borderRadius: 10, border: 'none', background: 'var(--accent)', color: '#000', cursor: 'pointer', opacity: (!name.trim() || saving) ? 0.5 : 1 }}
          >
            {saving ? 'Creating…' : 'Create'}
          </button>
          <button
            className="secondary"
            onClick={onClose}
            style={{ flex: 1, padding: '0.75rem', fontSize: '0.9rem', borderRadius: 10 }}
          >
            Cancel
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function UpcomingPage(): React.ReactElement {
  const [newTripOpen, setNewTripOpen] = useState(false)

  const { data: flights, isLoading } = useQuery({
    queryKey: ['flights', 'upcoming'],
    queryFn: () => api.flights.list('upcoming'),
    refetchInterval: 120_000,
  })

  const { data: trains = [] } = useQuery({
    queryKey: ['trains', 'upcoming'],
    queryFn: () => api.trains.list('upcoming'),
    refetchInterval: 120_000,
  })

  const { data: trips } = useQuery({
    queryKey: ['trips'],
    queryFn: api.trips.list,
  })

  const { data: connections } = useQuery({
    queryKey: ['connections'],
    queryFn: api.flights.connections,
    refetchInterval: 60_000,
  })

  const displayItems = buildDisplayItems(flights ?? [], trains)

  // Group display items by date
  const dateGroups = new Map<string, DisplayItem[]>()
  for (const item of displayItems) {
    const key = getItemDateKey(item)
    if (!dateGroups.has(key)) dateGroups.set(key, [])
    dateGroups.get(key)!.push(item)
  }

  let globalIndex = 0

  return (
    <>
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2 }}
    >
      <div className="page-header">
        <h1>Upcoming</h1>
      </div>

      {isLoading && (
        <div className="loading">
          <div className="loading-spinner" />
          Loading…
        </div>
      )}

      {/* Trips section */}
      <div style={{ marginBottom: '1.5rem' }}>
        <div className="section-label">Trips</div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
          {trips && trips.map(t => (
            <Link key={t.id} to={`/trips/${t.id}`} className="trip-chip">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 8h1a4 4 0 0 1 0 8h-1" />
                <path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V8z" />
                <line x1="6" y1="2" x2="6" y2="4" />
                <line x1="10" y1="2" x2="10" y2="4" />
                <line x1="14" y1="2" x2="14" y2="4" />
              </svg>
              {t.name}
              {t.startDate && (
                <span style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: '0.78rem' }}>
                  {formatDate(t.startDate)}
                </span>
              )}
            </Link>
          ))}
          <button
            onClick={() => setNewTripOpen(true)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.3rem',
              padding: '0.3rem 0.75rem',
              borderRadius: 99,
              border: '1px dashed var(--hairline)',
              background: 'transparent',
              color: 'var(--accent)',
              fontSize: '0.82rem',
              fontWeight: 600,
              cursor: 'pointer',
              lineHeight: 1,
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            New Trip
          </button>
        </div>
      </div>

      {flights && flights.length === 0 && trains.length === 0 && !isLoading && (
        <div className="empty">
          <h3>Nothing upcoming</h3>
          <p>Add a flight or train to start tracking</p>
        </div>
      )}

      {([...dateGroups.entries()] as [string, DisplayItem[]][]).map(
        ([dateKey, items]) => {
          const firstDeparture = getItemFirstDeparture(items[0])
          return (
            <div key={dateKey} style={{ marginBottom: '0.5rem' }}>
              <div className="date-group-header">
                {formatDate(dateKey)}
                <span className="countdown-chip">{countdownLabel(firstDeparture)}</span>
              </div>
              {items.map(item => {
                if (item.type === 'trip') {
                  const idx = globalIndex
                  globalIndex += item.legs.length
                  return (
                    <div key={item.tripId}>
                      <TripCard group={item} index={idx} />
                      {item.connections.map((conn, ci) =>
                        conn ? <InlineConnectionBadge key={ci} conn={conn} /> : null
                      )}
                    </div>
                  )
                }
                if (item.type === 'auto-itinerary') {
                  const legIds = item.legs.map(l => l.data.id).join('-')
                  return (
                    <div key={legIds} style={{ borderLeft: '2px solid var(--accent)', paddingLeft: '0.1rem', marginBottom: '0.5rem', opacity: 0.97 }}>
                      {item.legs.map((leg, i) => (
                        <div key={leg.data.id}>
                          {leg.legType === 'flight'
                            ? <FlightCard flight={leg.data} index={globalIndex++} />
                            : <TrainCard train={leg.data} index={globalIndex++} />}
                          {i < item.legs.length - 1 && item.connections[i] && (
                            <InlineConnectionBadge conn={item.connections[i]!} showGreen />
                          )}
                        </div>
                      ))}
                    </div>
                  )
                }
                if (item.type === 'standalone-train') {
                  const idx = globalIndex++
                  return <TrainCard key={item.train.id} train={item.train} index={idx} />
                }
                const f = item.flight
                const conn = connections?.find(c => c.flightId === f.id)
                const idx = globalIndex++
                return (
                  <div key={f.id}>
                    <FlightCard flight={f} index={idx} />
                    {conn && conn.risk !== 'green' && <ConnectionBadge conn={conn} />}
                  </div>
                )
              })}
            </div>
          )
        }
      )}
    </motion.div>

    <AnimatePresence>
      {newTripOpen && <NewTripDialog onClose={() => setNewTripOpen(false)} />}
    </AnimatePresence>
    </>
  )
}
