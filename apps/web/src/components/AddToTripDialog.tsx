import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import { api } from '../lib/api'
import type { Trip } from '../lib/api'

interface Props {
  /** The flight or train id */
  itemId: string
  itemType: 'flight' | 'train'
  /** Currently assigned tripId, if any */
  currentTripId: string | null
  onClose: () => void
}

export function AddToTripDialog({ itemId, itemType, currentTripId, onClose }: Props): React.ReactElement {
  const queryClient = useQueryClient()
  const [selected, setSelected] = useState<string | null>(currentTripId)
  const [showNewInput, setShowNewInput] = useState(false)
  const [newName, setNewName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { data: trips = [] } = useQuery<Trip[]>({
    queryKey: ['trips'],
    queryFn: api.trips.list,
  })

  async function handleSave(): Promise<void> {
    setSaving(true)
    setError(null)
    try {
      let tripId: string | null = selected

      // If user typed a new trip name, create it first
      if (showNewInput && newName.trim()) {
        const created = await api.trips.create({ name: newName.trim() })
        tripId = created.id
        await queryClient.invalidateQueries({ queryKey: ['trips'] })
      }

      if (itemType === 'flight') {
        await api.flights.patch(itemId, { tripId })
        await queryClient.invalidateQueries({ queryKey: ['flight', itemId] })
        await queryClient.invalidateQueries({ queryKey: ['flights'] })
      } else {
        await api.trains.patch(itemId, { tripId })
        await queryClient.invalidateQueries({ queryKey: ['train', itemId] })
        await queryClient.invalidateQueries({ queryKey: ['trains'] })
      }

      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save')
      setSaving(false)
    }
  }

  async function handleRemove(): Promise<void> {
    setSaving(true)
    setError(null)
    try {
      if (itemType === 'flight') {
        await api.flights.patch(itemId, { tripId: null })
        await queryClient.invalidateQueries({ queryKey: ['flight', itemId] })
        await queryClient.invalidateQueries({ queryKey: ['flights'] })
      } else {
        await api.trains.patch(itemId, { tripId: null })
        await queryClient.invalidateQueries({ queryKey: ['train', itemId] })
        await queryClient.invalidateQueries({ queryKey: ['trains'] })
      }
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove from trip')
      setSaving(false)
    }
  }

  const canSave = showNewInput ? newName.trim().length > 0 : selected !== currentTripId

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
          maxHeight: '80vh',
          overflowY: 'auto',
          boxShadow: '0 8px 40px rgba(0,0,0,0.5)',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
          <div style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text)' }}>Add to trip</div>
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

        {/* Trip list */}
        <div style={{ marginBottom: '0.75rem' }}>
          {trips.length === 0 && !showNewInput && (
            <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
              No trips yet. Create one below.
            </div>
          )}
          {trips.map(trip => {
            const isActive = selected === trip.id && !showNewInput
            return (
              <button
                key={trip.id}
                onClick={() => { setSelected(trip.id); setShowNewInput(false) }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.75rem',
                  width: '100%',
                  padding: '0.65rem 0.75rem',
                  marginBottom: '0.35rem',
                  borderRadius: 10,
                  border: `1px solid ${isActive ? 'var(--accent)' : 'var(--hairline)'}`,
                  background: isActive ? 'rgba(var(--accent-rgb, 250,204,21), 0.08)' : 'transparent',
                  cursor: 'pointer',
                  textAlign: 'left',
                  color: 'var(--text)',
                }}
              >
                <div style={{
                  width: 16, height: 16,
                  borderRadius: '50%',
                  border: `2px solid ${isActive ? 'var(--accent)' : 'var(--text-muted)'}`,
                  background: isActive ? 'var(--accent)' : 'transparent',
                  flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {isActive && (
                    <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
                      <circle cx="4" cy="4" r="3" fill="#000" />
                    </svg>
                  )}
                </div>
                <div>
                  <div style={{ fontSize: '0.875rem', fontWeight: isActive ? 700 : 500 }}>{trip.name}</div>
                  {trip.startDate && (
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.1rem' }}>{trip.startDate}</div>
                  )}
                </div>
                {currentTripId === trip.id && (
                  <span style={{ marginLeft: 'auto', fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--accent)', opacity: 0.8 }}>
                    Current
                  </span>
                )}
              </button>
            )
          })}
        </div>

        {/* Create new trip option */}
        <AnimatePresence>
          {showNewInput ? (
            <motion.div
              initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
              style={{ overflow: 'hidden', marginBottom: '1rem' }}
            >
              <input
                autoFocus
                value={newName}
                onChange={e => setNewName(e.target.value)}
                placeholder="Trip name…"
                onKeyDown={e => { if (e.key === 'Escape') { setShowNewInput(false); setNewName('') } }}
                style={{ width: '100%', padding: '0.6rem 0.75rem', fontSize: '0.9rem', borderRadius: 8, boxSizing: 'border-box', marginBottom: '0.4rem' }}
              />
            </motion.div>
          ) : (
            <button
              onClick={() => { setShowNewInput(true); setSelected(null) }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
                width: '100%',
                padding: '0.6rem 0.75rem',
                marginBottom: '1rem',
                borderRadius: 10,
                border: '1px dashed var(--hairline)',
                background: 'transparent',
                color: 'var(--accent)',
                fontSize: '0.875rem',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
              Create new trip
            </button>
          )}
        </AnimatePresence>

        {error && (
          <div style={{ color: 'var(--cancelled)', fontSize: '0.82rem', marginBottom: '0.75rem' }}>{error}</div>
        )}

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button
            onClick={() => void handleSave()}
            disabled={saving || !canSave}
            style={{
              flex: 1,
              padding: '0.75rem',
              fontSize: '0.9rem',
              fontWeight: 600,
              borderRadius: 10,
              border: 'none',
              background: 'var(--accent)',
              color: '#000',
              cursor: 'pointer',
              opacity: (!canSave || saving) ? 0.5 : 1,
            }}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button
            className="secondary"
            onClick={onClose}
            style={{ flex: 1, padding: '0.75rem', fontSize: '0.9rem', borderRadius: 10 }}
          >
            Cancel
          </button>
        </div>

        {/* Remove from trip */}
        {currentTripId && (
          <button
            onClick={() => void handleRemove()}
            disabled={saving}
            style={{
              display: 'block',
              width: '100%',
              padding: '0.65rem',
              marginTop: '0.5rem',
              fontSize: '0.82rem',
              borderRadius: 10,
              background: 'transparent',
              border: '1px solid rgba(248,113,113,0.3)',
              color: 'var(--cancelled)',
              cursor: 'pointer',
            }}
          >
            Remove from trip
          </button>
        )}
      </motion.div>
    </motion.div>
  )
}
