import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
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
  const [pushLoading, setPushLoading] = useState(false)
  const [pushSuccess, setPushSuccess] = useState(false)
  const [syncLoading, setSyncLoading] = useState(false)
  const [syncResult, setSyncResult] = useState<string | null>(null)

  const { data: user } = useQuery({ queryKey: ['me'], queryFn: api.auth.me })

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
      setSyncResult(`Found ${res.flightsFound} new flight(s) in your calendar.`)
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
                background: 'rgba(77,168,255,0.15)',
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
      {user?.isAdmin && (
        <>
          <div className="settings-section">
            <div className="settings-section-title">Data Sources</div>
            <SettingRow
              label="FlightAware API Key"
              hint="Real-time flight data"
              hintLink="https://www.flightaware.com/commercial/aeroapi"
              hintLinkText="Get a key at flightaware.com"
              currentValue={(settings?.flightaware_api_key as string | null) ?? null}
              onSave={v => saveSetting('flightaware_api_key', v)}
            />
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
            <span style={{ color: 'var(--on-time)', fontSize: '0.8rem', fontWeight: 600 }}>Enabled</span>
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
      </div>

      {/* Calendar */}
      <div className="settings-section">
        <div className="settings-section-title">Calendar</div>
        <div className="settings-row">
          <div>
            <div className="settings-row-label">Google Calendar</div>
            <div className="settings-row-sub">Automatically detect and import flights from your calendar events.</div>
          </div>
          <a href={`/api/auth/google?token=${encodeURIComponent(localStorage.getItem('token') ?? '')}`} style={{ flexShrink: 0 }}>
            <button className="secondary" style={{ padding: '0.4rem 0.875rem', fontSize: '0.8rem', whiteSpace: 'nowrap' }}>
              Connect
            </button>
          </a>
        </div>
        <div className="settings-row">
          <div className="settings-row-label">Sync now</div>
          <button className="secondary" onClick={() => void handleCalendarSync()} disabled={syncLoading} style={{ padding: '0.4rem 0.875rem', fontSize: '0.8rem', whiteSpace: 'nowrap' }}>
            {syncLoading ? 'Syncing…' : 'Sync'}
          </button>
        </div>
        {syncResult && (
          <div style={{ padding: '0.5rem 1rem 0.875rem', fontSize: '0.82rem', color: 'var(--text-muted)' }}>{syncResult}</div>
        )}
      </div>

      {/* About */}
      <div className="settings-section">
        <div className="settings-section-title">About</div>
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
