import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { api, clearToken } from '../lib/api'

async function subscribeToPush(): Promise<void> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    alert('Push notifications are not supported in this browser.')
    return
  }

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') {
    alert('Notification permission denied.')
    return
  }

  const { publicKey } = await api.push.getVapidKey()
  const reg = await navigator.serviceWorker.ready
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlB64ToUint8Array(publicKey),
  })

  const json = sub.toJSON() as { endpoint: string; keys?: { p256dh: string; auth: string } }
  if (!json.keys) throw new Error('No keys in push subscription')

  await api.push.subscribe({
    endpoint: json.endpoint,
    keys: json.keys,
  })
}

function urlB64ToUint8Array(base64String: string): ArrayBuffer {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = atob(base64)
  const arr = Uint8Array.from([...rawData].map(c => c.charCodeAt(0)))
  return arr.buffer as ArrayBuffer
}

function ChevronRight(): React.ReactElement {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  )
}

interface SettingRowProps {
  label: string
  hint: string
  hintLink?: string
  hintLinkText?: string
  currentValue: string | null
  onSave: (value: string) => Promise<void>
}

function SettingRow({ label, hint, hintLink, hintLinkText, currentValue, onSave }: SettingRowProps): React.ReactElement {
  const [editing, setEditing] = useState(false)
  const [inputValue, setInputValue] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleSave(): Promise<void> {
    if (!inputValue.trim()) return
    setSaving(true)
    try {
      await onSave(inputValue.trim())
      setEditing(false)
      setInputValue('')
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="settings-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '0.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div className="settings-row-label">{label}</div>
          <div className="settings-row-sub">
            {hint}
            {hintLink && hintLinkText && (
              <> — <a href={hintLink} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)' }}>{hintLinkText}</a></>
            )}
          </div>
          {currentValue && !editing && (
            <div className="settings-row-sub" style={{ fontFamily: 'monospace', marginTop: '0.2rem' }}>{currentValue}</div>
          )}
        </div>
        <button
          className="secondary"
          onClick={() => { setEditing(e => !e); setInputValue('') }}
          style={{ padding: '0.4rem 0.875rem', fontSize: '0.8rem', whiteSpace: 'nowrap', flexShrink: 0, marginLeft: '1rem' }}
        >
          {editing ? 'Cancel' : currentValue ? 'Update' : 'Set'}
        </button>
      </div>
      {editing && (
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <input
            type="text"
            value={inputValue}
            onChange={e => setInputValue(e.target.value)}
            placeholder={`Enter ${label.toLowerCase()}…`}
            style={{ flex: 1, fontSize: '0.85rem', padding: '0.4rem 0.6rem', background: 'var(--surface-raised)', border: '1px solid var(--border)', borderRadius: '0.5rem', color: 'var(--text)' }}
            onKeyDown={e => { if (e.key === 'Enter') void handleSave() }}
            autoFocus
          />
          <button
            onClick={() => void handleSave()}
            disabled={saving || !inputValue.trim()}
            style={{ padding: '0.4rem 0.875rem', fontSize: '0.8rem', whiteSpace: 'nowrap' }}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      )}
    </div>
  )
}

interface ToggleRowProps {
  label: string
  hint: string
  checked: boolean
  onChange: (val: boolean) => Promise<void>
}

function ToggleRow({ label, hint, checked, onChange }: ToggleRowProps): React.ReactElement {
  const [saving, setSaving] = useState(false)

  async function handleChange(): Promise<void> {
    setSaving(true)
    try {
      await onChange(!checked)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="settings-row">
      <div>
        <div className="settings-row-label">{label}</div>
        <div className="settings-row-sub">{hint}</div>
      </div>
      <button
        role="switch"
        aria-checked={checked}
        onClick={() => void handleChange()}
        disabled={saving}
        style={{
          padding: '0',
          width: 44,
          height: 26,
          borderRadius: 99,
          background: checked ? 'var(--accent)' : 'var(--surface-raised)',
          border: `1px solid ${checked ? 'transparent' : 'var(--hairline)'}`,
          position: 'relative',
          flexShrink: 0,
          transition: 'background 0.2s',
        }}
      >
        <span style={{
          position: 'absolute',
          top: 3,
          left: checked ? 20 : 3,
          width: 18,
          height: 18,
          borderRadius: '50%',
          background: '#fff',
          boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
          transition: 'left 0.2s',
          display: 'block',
        }} />
      </button>
    </div>
  )
}

export function SettingsPage(): React.ReactElement {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [adminMode, setAdminMode] = useState(() =>
    localStorage.getItem('adminMode') !== 'false'
  )
  const [tempUnit, setTempUnit] = useState<'F' | 'C'>(() =>
    (localStorage.getItem('tempUnit') as 'F' | 'C') ?? 'F'
  )
  const handleTempUnit = (unit: 'F' | 'C'): void => {
    setTempUnit(unit)
    localStorage.setItem('tempUnit', unit)
  }
  const toggleAdminMode = (): void => {
    const next = !adminMode
    setAdminMode(next)
    localStorage.setItem('adminMode', String(next))
  }
  const [pushLoading, setPushLoading] = useState(false)
  const [pushSuccess, setPushSuccess] = useState(false)
  const [syncLoading, setSyncLoading] = useState(false)
  const [syncResult, setSyncResult] = useState<string | null>(null)
  const [simFlightId, setSimFlightId] = useState('')
  const [simRunning, setSimRunning] = useState(false)
  const [simMessage, setSimMessage] = useState<string | null>(null)

  // Detect an existing push subscription on mount so "Enabled" persists across reloads
  useEffect(() => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return
    void navigator.serviceWorker.ready.then((reg) => {
      return reg.pushManager.getSubscription()
    }).then((sub) => {
      if (sub) setPushSuccess(true)
    })
  }, [])

  const [searchParams, setSearchParams] = useSearchParams()
  const calendarStatus = searchParams.get('calendar')

  const { data: user } = useQuery({ queryKey: ['me'], queryFn: api.auth.me, staleTime: 0, refetchOnMount: 'always' })
  const { data: allFlights } = useQuery({ queryKey: ['flights'], queryFn: () => api.flights.list() })

  // Public: which integrations the admin has configured
  const { data: features } = useQuery({
    queryKey: ['features'],
    queryFn: api.features.get,
  })

  // Only fetch settings if admin
  const { data: settings, refetch: refetchSettings } = useQuery({
    queryKey: ['settings'],
    queryFn: api.settings.get,
    enabled: user?.isAdmin === true,
    retry: false,
  })

  function handleLogout(): void {
    clearToken()
    queryClient.clear()
    navigate('/login')
  }

  async function handleEnableNotifications(): Promise<void> {
    setPushLoading(true)
    try {
      await subscribeToPush()
      setPushSuccess(true)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to enable notifications')
    } finally {
      setPushLoading(false)
    }
  }

  async function handleCalendarSync(): Promise<void> {
    setSyncLoading(true)
    setSyncResult(null)
    try {
      const res = await api.calendar.sync()
      const parts: string[] = []
      if (res.flightsFound > 0) parts.push(`${res.flightsFound} flight${res.flightsFound !== 1 ? 's' : ''}`)
      if (res.trainsFound > 0) parts.push(`${res.trainsFound} train${res.trainsFound !== 1 ? 's' : ''}`)
      setSyncResult(parts.length > 0 ? `Added ${parts.join(' and ')} from your calendar.` : 'Calendar synced — nothing new found.')
      await queryClient.invalidateQueries({ queryKey: ['flights'] })
    } catch (err) {
      setSyncResult(err instanceof Error ? err.message : 'Sync failed')
    } finally {
      setSyncLoading(false)
    }
  }

  async function saveSetting(key: string, value: string): Promise<void> {
    await api.settings.set(key, value)
    await refetchSettings()
  }

  async function toggleAllowRegistration(val: boolean): Promise<void> {
    await api.settings.set('allow_registration', val ? 'true' : 'false')
    await refetchSettings()
  }

  const allowRegistration = settings?.allow_registration === 'true'

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2 }}
    >
      <div className="page-header">
        <h1>Settings</h1>
      </div>

      <div className="settings-admin-toggle">
        <span>Admin mode</span>
        <button
          className={`toggle-btn${adminMode ? ' active' : ''}`}
          onClick={toggleAdminMode}
          aria-label="Toggle admin mode"
        >
          <span className="toggle-knob" />
        </button>
      </div>

      {/* Account */}
      <div className="settings-section">
        <div className="settings-section-title">Account</div>
        {user && (
          <div className="settings-row">
            <div>
              <div className="settings-row-label">{user.name}</div>
              <div className="settings-row-sub">{user.email}</div>
            </div>
            {user.isAdmin && (
              <span style={{
                fontSize: '0.68rem',
                fontWeight: 700,
                background: 'var(--accent-dim)',
                color: 'var(--accent)',
                borderRadius: 99,
                padding: '0.2rem 0.6rem',
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                flexShrink: 0,
              }}>
                Admin
              </span>
            )}
          </div>
        )}
        <div className="settings-row" style={{ cursor: 'pointer' }} onClick={handleLogout}>
          <div className="settings-row-label" style={{ color: 'var(--cancelled)' }}>Sign out</div>
          <ChevronRight />
        </div>
      </div>

      {/* Admin-only: Data Sources + Admin controls */}
      {user?.isAdmin && adminMode && (
        <>
          <div className="settings-section">
            <div className="settings-section-title">Flight Data</div>
            <div style={{ padding: '0 1rem 0.75rem', fontSize: '0.78rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
              Set one source to get real flight tracking for everyone. Until then the app runs on realistic demo data.
            </div>
            <SettingRow
              label="AeroDataBox API Key"
              hint="Recommended · free 600 lookups/month, no credit card"
              hintLink="https://rapidapi.com/aedbx-aedbx/api/aerodatabox"
              hintLinkText="Get a free key on RapidAPI"
              currentValue={(settings?.aerodatabox_api_key as string | null) ?? null}
              onSave={v => saveSetting('aerodatabox_api_key', v)}
            />
            <SettingRow
              label="FlightAware API Key"
              hint="Premium alternative · most complete data ($5/mo free credit)"
              hintLink="https://www.flightaware.com/commercial/aeroapi"
              hintLinkText="Get a key at flightaware.com"
              currentValue={(settings?.flightaware_api_key as string | null) ?? null}
              onSave={v => saveSetting('flightaware_api_key', v)}
            />
          </div>

          <div className="settings-section">
            <div className="settings-section-title">Integrations</div>
            <SettingRow
              label="Google Client ID"
              hint="Required for Google Calendar import"
              hintLink="https://console.cloud.google.com"
              hintLinkText="console.cloud.google.com"
              currentValue={(settings?.google_client_id as string | null) ?? null}
              onSave={v => saveSetting('google_client_id', v)}
            />
            <SettingRow
              label="Google Client Secret"
              hint="Required for Google Calendar import"
              currentValue={(settings?.google_client_secret as string | null) ?? null}
              onSave={v => saveSetting('google_client_secret', v)}
            />
            <SettingRow
              label="Contact Email"
              hint="Used as VAPID subject for push notifications (e.g. mailto:you@example.com)"
              currentValue={(settings?.vapid_subject as string | null) ?? null}
              onSave={v => saveSetting('vapid_subject', v)}
            />
          </div>

          <div className="settings-section">
            <div className="settings-section-title">Admin</div>
            <ToggleRow
              label="Allow new registrations"
              hint="When off, the registration page is disabled."
              checked={allowRegistration}
              onChange={toggleAllowRegistration}
            />

          </div>
        </>
      )}

      {/* Notifications */}
      <div className="settings-section">
        <div className="settings-section-title">Notifications</div>
        <div className="settings-row">
          <div>
            <div className="settings-row-label">Push Notifications</div>
            <div className="settings-row-sub">Gate changes, delays, and baggage claim info.<br />Requires iOS 16.4+ when installed as PWA.</div>
          </div>
          {pushSuccess ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}>
              <span style={{ color: 'var(--on-time)', fontSize: '0.8rem', fontWeight: 600 }}>Enabled</span>
              {adminMode && (
                <button
                  className="secondary"
                  onClick={() => {
                    api.push.test().then(() => alert('Test notification sent!')).catch((err) => alert(err instanceof Error ? err.message : 'Failed to send test'))
                  }}
                  style={{ padding: '0.4rem 0.875rem', fontSize: '0.8rem', whiteSpace: 'nowrap' }}
                >
                  Send test
                </button>
              )}
            </div>
          ) : (
            <button
              onClick={() => void handleEnableNotifications()}
              disabled={pushLoading}
              style={{ padding: '0.4rem 0.875rem', fontSize: '0.8rem', whiteSpace: 'nowrap', flexShrink: 0 }}
            >
              {pushLoading ? 'Enabling…' : 'Enable'}
            </button>
          )}
        </div>

        {adminMode && pushSuccess && allFlights && allFlights.length > 0 && (
          <div className="settings-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '0.5rem' }}>
            <div>
              <div className="settings-row-label">Simulate flight lifecycle</div>
              <div className="settings-row-sub">
                Fires 6 push notifications over ~25 seconds — boarding → gate → departed → en route → landed → baggage.
                Close the app first so you see them as real background notifications.
              </div>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <select
                value={simFlightId}
                onChange={e => { setSimFlightId(e.target.value); setSimMessage(null) }}
                style={{ flex: 1, fontSize: '0.82rem', padding: '0.4rem 0.6rem', background: 'var(--surface-raised)', border: '1px solid var(--border)', borderRadius: '0.5rem', color: 'var(--text)' }}
              >
                <option value="">Pick a flight…</option>
                {allFlights.map(f => (
                  <option key={f.id} value={f.id}>
                    {f.ident} · {f.origin}→{f.destination}
                  </option>
                ))}
              </select>
              <button
                disabled={!simFlightId || simRunning}
                onClick={() => {
                  setSimRunning(true)
                  setSimMessage(null)
                  api.push.simulate(simFlightId)
                    .then(() => setSimMessage('Simulation started — 6 notifications will arrive over 25 seconds.'))
                    .catch(err => setSimMessage(err instanceof Error ? err.message : 'Failed'))
                    .finally(() => setSimRunning(false))
                }}
                style={{ padding: '0.4rem 0.875rem', fontSize: '0.8rem', whiteSpace: 'nowrap' }}
              >
                {simRunning ? 'Starting…' : 'Simulate'}
              </button>
            </div>
            {simMessage && (
              <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', paddingBottom: '0.25rem' }}>{simMessage}</div>
            )}
          </div>
        )}
      </div>

      {/* Calendar */}
      <div className="settings-section">
        <div className="settings-section-title">Calendar</div>

        {calendarStatus === 'connected' && (
          <div style={{ margin: '0 0 0.5rem', padding: '0.7rem 1rem', borderRadius: 12, background: 'rgba(52,211,153,0.1)', border: '1px solid rgba(52,211,153,0.2)', fontSize: '0.82rem', color: 'var(--on-time)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12" /></svg>
            Google Calendar connected. Tap Sync to import flights and trains.
            <button onClick={() => setSearchParams({})} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--on-time)', cursor: 'pointer', fontSize: '1.1rem', padding: 0, lineHeight: 1 }}>×</button>
          </div>
        )}
        {calendarStatus === 'not_configured' && (
          <div style={{ margin: '0 0 0.5rem', padding: '0.7rem 1rem', borderRadius: 12, background: 'rgba(251,191,36,0.1)', border: '1px solid rgba(251,191,36,0.25)', fontSize: '0.82rem', color: 'var(--delayed)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            Google Calendar isn’t set up yet{user?.isAdmin ? '. Add a Client ID & Secret in Data Sources above.' : '. Ask your admin to configure it.'}
            <button onClick={() => setSearchParams({})} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--delayed)', cursor: 'pointer', fontSize: '1.1rem', padding: 0, lineHeight: 1 }}>×</button>
          </div>
        )}

        <div className="settings-row">
          <div>
            <div className="settings-row-label">Google Calendar</div>
            <div className="settings-row-sub">
              {features?.googleCalendar
                ? 'Automatically detect and import flights from your calendar events.'
                : user?.isAdmin
                  ? 'Add a Google Client ID & Secret in Data Sources to enable calendar import.'
                  : 'Not available — your admin hasn’t set up Google Calendar.'}
            </div>
          </div>
          {features?.googleCalendar ? (
            <a href={`/api/auth/google?token=${encodeURIComponent(localStorage.getItem('token') ?? '')}`} style={{ flexShrink: 0 }}>
              <button className="secondary" style={{ padding: '0.4rem 0.875rem', fontSize: '0.8rem', whiteSpace: 'nowrap' }}>
                Connect
              </button>
            </a>
          ) : (
            <button className="secondary" disabled style={{ padding: '0.4rem 0.875rem', fontSize: '0.8rem', whiteSpace: 'nowrap', opacity: 0.5, cursor: 'not-allowed', flexShrink: 0 }}>
              Connect
            </button>
          )}
        </div>
        {features?.googleCalendar && (
          <div className="settings-row">
            <div className="settings-row-label">Sync now</div>
            <button className="secondary" onClick={() => void handleCalendarSync()} disabled={syncLoading} style={{ padding: '0.4rem 0.875rem', fontSize: '0.8rem', whiteSpace: 'nowrap' }}>
              {syncLoading ? 'Syncing…' : 'Sync'}
            </button>
          </div>
        )}
        {syncResult && (
          <div style={{ padding: '0.5rem 1rem 0.875rem', fontSize: '0.82rem', color: 'var(--text-muted)' }}>{syncResult}</div>
        )}
      </div>

      {/* Display */}
      <div className="settings-section">
        <div className="settings-section-title">Display</div>
        <div className="settings-row">
          <div className="settings-row-label">Temperature</div>
          <div style={{ display: 'flex', gap: '0.25rem', flexShrink: 0 }}>
            {(['F', 'C'] as const).map(unit => (
              <button
                key={unit}
                onClick={() => handleTempUnit(unit)}
                style={{
                  padding: '0.3rem 0.75rem',
                  fontSize: '0.82rem',
                  background: tempUnit === unit ? 'var(--accent)' : 'var(--surface-raised)',
                  color: tempUnit === unit ? '#fff' : 'var(--text)',
                  border: `1px solid ${tempUnit === unit ? 'var(--accent)' : 'var(--hairline)'}`,
                  borderRadius: 8,
                }}
              >
                °{unit}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* About */}
      <div className="settings-section">
        <div className="settings-section-title">About</div>
        <div className="settings-row">
          <div>
            <div className="settings-row-label">Flight data</div>
            <div className="settings-row-sub">
              {features?.liveData
                ? `Live tracking via ${features.provider}.`
                : 'Running on realistic demo data.' + (user?.isAdmin ? ' Add a flight-data key above for real tracking.' : ' Ask your admin to enable live tracking.')}
            </div>
          </div>
          <span style={{
            fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase',
            borderRadius: 99, padding: '0.2rem 0.6rem', flexShrink: 0,
            background: features?.liveData ? 'rgba(61,220,151,0.15)' : 'var(--accent-2-dim)',
            color: features?.liveData ? 'var(--on-time)' : 'var(--accent)',
          }}>
            {features?.liveData ? 'Live' : 'Demo'}
          </span>
        </div>
        <div className="settings-row">
          <div>
            <div className="settings-row-label">Install on iOS</div>
            <div className="settings-row-sub">
              Open in Safari → Share → Add to Home Screen.<br />
              Push notifications require iOS 16.4 or later.
            </div>
          </div>
        </div>
        <div className="settings-row">
          <div className="settings-row-label">Departarr</div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>v0.1.0</div>
        </div>
      </div>
    </motion.div>
  )
}
