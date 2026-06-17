import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient, useQuery } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import { api, type FlightPreview, type TrainPreview, type UpcomingOccurrence, type ProviderId } from '../lib/api'
import { getAirport } from '../lib/airports'
import { formatTimeInZone, getAirportTz, getAmtrakStationTz, formatRelativeDayInZone } from '../lib/format'
import { StatusBadge } from '../components/StatusBadge'

type Step = 'form' | 'pick-date' | 'pick-leg' | 'confirm'
type AddMode = 'flight' | 'train'

/** Format a stop's absolute ISO time in its own timezone as HH:MM (24h). */
function fmtStopTime(iso: string | null | undefined, tz: string | undefined, fallbackCode: string): string {
  if (!iso) return ''
  const zone = tz ?? getAmtrakStationTz(fallbackCode) ?? 'UTC'
  return new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso))
}

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

/** Sort legs by departure time, closest to now first. */
function sortLegsByTime(legs: FlightPreview[]): FlightPreview[] {
  const now = Date.now()
  return [...legs].sort((a, b) => {
    const aTime = new Date(a.departureEstimated ?? a.departureScheduled).getTime()
    const bTime = new Date(b.departureEstimated ?? b.departureScheduled).getTime()
    return Math.abs(aTime - now) - Math.abs(bTime - now)
  })
}

/**
 * ADD-7: turn a lookup failure into a clear, differentiated message. The server
 * distinguishes 404 (not found) from over-budget and network errors via the
 * thrown Error message, so we can hint "try another date" only when it helps.
 */
function describeLookupError(err: unknown, mode: AddMode): string {
  const msg = err instanceof Error ? err.message : ''
  const lower = msg.toLowerCase()
  if (!navigator.onLine || lower.includes('failed to fetch') || lower.includes('networkerror')) {
    return 'Network problem — check your connection and try again.'
  }
  if (lower.includes('budget') || lower.includes('quota') || msg.includes('429')) {
    return 'Live data is over its monthly budget right now. Try again later.'
  }
  if (lower.includes('no upcoming') || lower.includes('not found') || msg.includes('404')) {
    return mode === 'train'
      ? 'Could not find that train. Double-check the number and date.'
      : "Couldn't find that flight in the next 7 days. Check the flight number, or try a specific date."
  }
  return msg || (mode === 'train' ? 'Could not find that train' : 'Could not find that flight')
}

export function AddFlightPage(): React.ReactElement {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [mode, setMode] = useState<AddMode>('flight')
  const [ident, setIdent] = useState('')
  // Empty by default: a blank flight date means "find the next occurrence"; a
  // value means "find this exact date" (honoured, never overridden). Trains
  // always need a date (GTFS lookup is date-specific).
  const [date, setDate] = useState('')
  // The date the user actually picked for a flight (set from the upcoming list).
  // Distinct from the optional `date` form field, which only seeds train lookup.
  const [selectedDate, setSelectedDate] = useState('')
  const [tripId, setTripId] = useState('')
  const [error, setError] = useState('')
  const [looking, setLooking] = useState(false)
  const [adding, setAdding] = useState(false)
  const [step, setStep] = useState<Step>('form')
  const [legs, setLegs] = useState<FlightPreview[]>([])
  const [occurrences, setOccurrences] = useState<UpcomingOccurrence[]>([])
  const [provider, setProvider] = useState<ProviderId | null>(null)
  const [preview, setPreview] = useState<FlightPreview | null>(null)
  const [trainPreview, setTrainPreview] = useState<TrainPreview | null>(null)
  const [boardingStopCode, setBoardingStopCode] = useState<string>('')
  const [arrivingStopCode, setArrivingStopCode] = useState<string>('')

  const { data: trips } = useQuery({ queryKey: ['trips'], queryFn: api.trips.list })

  async function handleLookup(e: FormEvent): Promise<void> {
    e.preventDefault()
    setError('')
    setLooking(true)
    try {
      if (mode === 'train') {
        if (!date) {
          setError('Pick the travel date for your train.')
          return
        }
        const tp = await api.trains.lookup(ident.trim(), date)
        setTrainPreview(tp)
        setBoardingStopCode(tp.origin)
        setArrivingStopCode(tp.destination)
        setStep('confirm')
      } else {
        const clean = ident.toUpperCase().replace(/\s+/g, '')
        if (date) {
          // The user picked a specific date — honour it exactly, never override
          // with the nearest occurrence. Looks up only that calendar day.
          const { provider, legs } = await api.flights.lookupAll(clean, date)
          setProvider(provider)
          setSelectedDate(date)
          if (legs.length === 1) {
            setPreview(legs[0])
            setStep('confirm')
          } else {
            setLegs(sortLegsByTime(legs))
            setStep('pick-leg')
          }
          return
        }
        // ADD-2/ADD-3: no date given → find the next occurrence across the next
        // week. The user then picks which date.
        const result = await api.flights.lookupUpcoming(clean)
        setProvider(result.provider)
        const occ = result.occurrences
        // Single date + single leg → straight to confirm.
        if (occ.length === 1 && occ[0].legs.length === 1) {
          setSelectedDate(occ[0].date)
          setPreview(occ[0].legs[0])
          setStep('confirm')
        } else if (occ.length === 1) {
          // One date, multiple legs → leg picker.
          setSelectedDate(occ[0].date)
          setLegs(sortLegsByTime(occ[0].legs))
          setStep('pick-leg')
        } else {
          setOccurrences(occ)
          setStep('pick-date')
        }
      }
    } catch (err) {
      setError(describeLookupError(err, mode))
    } finally {
      setLooking(false)
    }
  }

  function handlePickDate(occ: UpcomingOccurrence): void {
    setSelectedDate(occ.date)
    if (occ.legs.length === 1) {
      setPreview(occ.legs[0])
      setStep('confirm')
    } else {
      setLegs(sortLegsByTime(occ.legs))
      setStep('pick-leg')
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
        const boardingStop = trainPreview.stops.find(s => s.code === boardingStopCode)
        const origin = boardingStopCode || trainPreview.origin
        const destination = arrivingStopCode || trainPreview.destination
        const train = await api.trains.add({
          trainNumber: ident.trim(),
          date,
          tripId: tripId || undefined,
          origin,
          destination,
          boardingStop: boardingStop ? { code: boardingStop.code, schDep: boardingStop.schDep ?? undefined } : undefined,
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
      // ADD-8: pass the confirmed preview so the server doesn't re-query the
      // provider (no double lookup, no extra budget spend).
      const flight = await api.flights.add({
        ident: ident.toUpperCase().replace(/\s+/g, ''),
        date: selectedDate || preview.departureScheduled.substring(0, 10) || date,
        tripId: tripId || undefined,
        origin: preview.origin,
        dest: preview.destination,
        preview,
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
          onClick={() => { setMode('flight'); setStep('form'); setError(''); setIdent(''); setPreview(null); setTrainPreview(null); setOccurrences([]); setLegs([]); setProvider(null) }}
        >
          <PlaneIcon /> Flight
        </button>
        <button
          type="button"
          className={`mode-btn${mode === 'train' ? ' active' : ''}`}
          onClick={() => { setMode('train'); setStep('form'); setError(''); setIdent(''); setPreview(null); setTrainPreview(null); setOccurrences([]); setLegs([]); setProvider(null) }}
        >
          <TrainIconBtn /> Train
        </button>
      </div>

      {error && <div className="error-box" style={{ maxWidth: 480 }}>{error}</div>}

      {/* ADD-6: be honest when results are synthesized demo data (no API key). */}
      {mode === 'flight' && provider === 'demo' && step !== 'form' && (
        <div
          style={{
            maxWidth: 480,
            marginBottom: '0.85rem',
            padding: '0.6rem 0.85rem',
            borderRadius: 'var(--radius)',
            border: '1px solid color-mix(in srgb, var(--accent) 35%, transparent)',
            background: 'color-mix(in srgb, var(--accent) 8%, transparent)',
            color: 'var(--text-muted)',
            fontSize: '0.78rem',
          }}
        >
          <strong style={{ color: 'var(--text)' }}>Demo data</strong> — no flight-data API key is configured, so these times are realistic but simulated.
        </div>
      )}

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
                  <label>{mode === 'train' ? 'Date' : 'Date (optional)'}</label>
                  <input type="date" value={date} onChange={e => setDate(e.target.value)} required={mode === 'train'} />
                </div>
              </div>
              {mode === 'flight' && (
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '-0.35rem', marginBottom: '0.25rem' }}>
                  Just enter the flight number — we'll find the next departure. The date is only used as a hint.
                </div>
              )}

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
                  ) : mode === 'train' ? 'Look up train' : 'Find flight'}
                </button>
                <button type="button" className="secondary" onClick={() => navigate(-1)}>Cancel</button>
              </div>
            </form>
          </motion.div>
        )}

        {step === 'pick-date' && (
          <motion.div
            key="pick-date"
            initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            style={{ maxWidth: 480 }}
          >
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '0.75rem' }}>
              <strong style={{ color: 'var(--text)' }}>{ident.toUpperCase()}</strong> next flies on these dates. Pick your departure.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
              {occurrences.map((occ, oi) => {
                const isNext = oi === 0
                const firstLeg = sortLegsByTime(occ.legs)[0]
                const orig = getAirport(firstLeg.origin)
                const dest = getAirport(firstLeg.destination)
                const depTime = firstLeg.departureEstimated ?? firstLeg.departureScheduled
                const originTz = getAirportTz(firstLeg.origin)
                const relDay = formatRelativeDayInZone(new Date(occ.date + 'T12:00:00Z'), new Date(), 'UTC')
                return (
                  <button
                    key={occ.date}
                    onClick={() => handlePickDate(occ)}
                    style={{
                      textAlign: 'left',
                      padding: '1rem 1.1rem',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '1rem',
                      background: 'var(--card-bg)',
                      border: isNext ? '1.5px solid var(--accent)' : '1.5px solid var(--border)',
                      borderRadius: 'var(--radius)',
                      cursor: 'pointer',
                      width: '100%',
                      transition: 'border-color 0.15s, box-shadow 0.15s',
                    }}
                  >
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                        <span style={{ fontWeight: 700, fontSize: '0.95rem' }}>{relDay}</span>
                        {isNext && (
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
                            Next departure
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                        {firstLeg.origin} → {firstLeg.destination}
                        {occ.legs.length > 1 ? ` · ${occ.legs.length} legs` : ` · ${orig?.city ?? firstLeg.origin} to ${dest?.city ?? firstLeg.destination}`}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: '1rem', fontFamily: 'monospace', letterSpacing: '0.04em' }}>
                        {formatTimeInZone(depTime, originTz)}
                      </div>
                      <div style={{ marginTop: '0.25rem' }}>
                        <StatusBadge status={firstLeg.status} />
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

        {step === 'pick-leg' && (
          <motion.div
            key="pick-leg"
            initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            style={{ maxWidth: 480 }}
          >
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '0.75rem' }}>
              <strong style={{ color: 'var(--text)' }}>{ident.toUpperCase()}</strong> has {legs.length} flights{selectedDate ? ` on ${formatRelativeDayInZone(new Date(selectedDate + 'T12:00:00Z'), new Date(), 'UTC')}` : ''}. Which leg is yours?
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
                        {formatTimeInZone(depTime, originTz)}
                      </div>
                      {arrTime && (
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.1rem' }}>
                          → {formatTimeInZone(arrTime, getAirportTz(leg.destination))}
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
              <button type="button" className="secondary" onClick={() => { setStep(occurrences.length > 1 ? 'pick-date' : 'form'); setError('') }}>
                ← Back
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
                  <span>{boardingStopCode || trainPreview.origin}</span>
                  <span className="detail-route-sep">›</span>
                  <span>{arrivingStopCode || trainPreview.destination}</span>
                </div>
                <div style={{ color: 'var(--text-muted)', fontSize: '0.82rem', marginTop: '0.25rem' }}>
                  Train {trainPreview.trainNumber}{trainPreview.trainName ? ` · ${trainPreview.trainName}` : ''}
                </div>
                {(() => {
                  const boardingStop = trainPreview.stops.find(s => s.code === boardingStopCode)
                  const alightingStop = trainPreview.stops.find(s => s.code === arrivingStopCode)
                  const boardingName = boardingStop?.name ?? trainPreview.originName
                  const alightingName = alightingStop?.name ?? trainPreview.destinationName
                  return (boardingName || alightingName) ? (
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.5rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      <span>{boardingName ?? boardingStopCode}</span>
                      <span>{alightingName ?? arrivingStopCode}</span>
                    </div>
                  ) : null
                })()}
              </div>

              {/* Boarding / arriving stop pickers */}
              {trainPreview.stops.length > 1 && (
                <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.875rem' }}>
                  <div style={{ flex: 1 }}>
                    <label style={{ fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', display: 'block', marginBottom: '0.35rem' }}>
                      Boarding at
                    </label>
                    <select
                      value={boardingStopCode}
                      onChange={e => setBoardingStopCode(e.target.value)}
                      style={{ width: '100%', padding: '0.5rem 0.6rem', borderRadius: 10, border: '1px solid var(--hairline)', background: 'var(--card)', color: 'var(--text)', fontSize: '0.82rem', appearance: 'none', cursor: 'pointer' }}
                    >
                      {trainPreview.stops.map((stop, i) => (
                        <option key={`${stop.code}-${i}`} value={stop.code}>
                          {stop.code} — {stop.name}{stop.schDep ? ` (${fmtStopTime(stop.schDep, stop.tz, stop.code)})` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={{ fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', display: 'block', marginBottom: '0.35rem' }}>
                      Arriving at
                    </label>
                    <select
                      value={arrivingStopCode}
                      onChange={e => setArrivingStopCode(e.target.value)}
                      style={{ width: '100%', padding: '0.5rem 0.6rem', borderRadius: 10, border: '1px solid var(--hairline)', background: 'var(--card)', color: 'var(--text)', fontSize: '0.82rem', appearance: 'none', cursor: 'pointer' }}
                    >
                      {trainPreview.stops.map((stop, i) => (
                        <option key={`${stop.code}-${i}`} value={stop.code}>
                          {stop.code} — {stop.name}{(stop.schDep ?? stop.schArr) ? ` (${fmtStopTime(stop.schDep ?? stop.schArr, stop.tz, stop.code)})` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}

              <div className="info-grid" style={{ marginTop: '0.875rem' }}>
                <div className="info-cell">
                  <div className="info-cell-label">Departure</div>
                  <div className="info-cell-value">
                    {(() => {
                      const sel = trainPreview.stops.find(s => s.code === boardingStopCode)
                      const iso = sel?.schDep ?? sel?.schArr ?? trainPreview.departureScheduled
                      const tz = sel?.tz ?? getAmtrakStationTz(boardingStopCode || trainPreview.origin)
                      return new Intl.DateTimeFormat('en-US', { timeZone: tz ?? 'UTC', hour: '2-digit', minute: '2-digit', hour12: true, timeZoneName: 'short' }).format(new Date(iso))
                    })()}
                  </div>
                </div>
                <div className="info-cell">
                  <div className="info-cell-label">Arrival</div>
                  <div className="info-cell-value">
                    {(() => {
                      const lastStop = trainPreview.stops[trainPreview.stops.length - 1]
                      const sel = trainPreview.stops.find(s => s.code === arrivingStopCode) ?? lastStop
                      const iso = sel?.schArr ?? sel?.schDep ?? trainPreview.arrivalScheduled
                      const tz = sel?.tz ?? getAmtrakStationTz(arrivingStopCode || trainPreview.destination)
                      return new Intl.DateTimeFormat('en-US', { timeZone: tz ?? 'UTC', hour: '2-digit', minute: '2-digit', hour12: true, timeZoneName: 'short' }).format(new Date(iso))
                    })()}
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
                      {(stop.schDep ?? stop.schArr) && <span style={{ fontFamily: 'var(--font-mono)' }}>{fmtStopTime(stop.schDep ?? stop.schArr, stop.tz, stop.code)}</span>}
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
                        {(last.schDep ?? last.schArr) && <span style={{ fontFamily: 'var(--font-mono)' }}>{fmtStopTime(last.schDep ?? last.schArr, last.tz, last.code)}</span>}
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
                  <div className="info-cell-value">{formatTimeInZone(preview.departureEstimated ?? preview.departureScheduled, originTz)}</div>
                </div>
                <div className="info-cell">
                  <div className="info-cell-label">Arrival</div>
                  <div className="info-cell-value">{formatTimeInZone(preview.arrivalEstimated ?? preview.arrivalScheduled, destTz)}</div>
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
                onClick={() => { setStep(legs.length > 1 ? 'pick-leg' : occurrences.length > 1 ? 'pick-date' : 'form'); setError('') }}
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
