import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
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

export function SettingsPage(): React.ReactElement {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [pushLoading, setPushLoading] = useState(false)
  const [pushSuccess, setPushSuccess] = useState(false)
  const [syncLoading, setSyncLoading] = useState(false)
  const [syncResult, setSyncResult] = useState<string | null>(null)

  const { data: user } = useQuery({ queryKey: ['me'], queryFn: api.auth.me })

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

  return (
    <>
      <div className="page-header">
        <h1>Settings</h1>
      </div>

      {/* Account */}
      <div className="card" style={{ marginBottom: '1rem' }}>
        <h2 style={{ fontSize: '1rem', marginBottom: '0.75rem' }}>Account</h2>
        {user && (
          <p style={{ marginBottom: '0.75rem', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
            Signed in as <strong style={{ color: 'var(--text)' }}>{user.email}</strong>
          </p>
        )}
        <button className="secondary danger" onClick={handleLogout}>Sign out</button>
      </div>

      {/* Push notifications */}
      <div className="card" style={{ marginBottom: '1rem' }}>
        <h2 style={{ fontSize: '1rem', marginBottom: '0.5rem' }}>Push Notifications</h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginBottom: '0.75rem' }}>
          Get notified of gate changes, delays, and baggage claim info. Requires iOS 16.4+ when installed as a PWA.
        </p>
        {pushSuccess ? (
          <p style={{ color: 'var(--green)', fontSize: '0.9rem' }}>Notifications enabled!</p>
        ) : (
          <button onClick={() => void handleEnableNotifications()} disabled={pushLoading}>
            {pushLoading ? 'Enabling…' : 'Enable notifications'}
          </button>
        )}
      </div>

      {/* Google Calendar */}
      <div className="card" style={{ marginBottom: '1rem' }}>
        <h2 style={{ fontSize: '1rem', marginBottom: '0.5rem' }}>Google Calendar</h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginBottom: '0.75rem' }}>
          Connect your Google Calendar to automatically detect and import flights from your events.
        </p>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          <a href="/api/auth/google">
            <button className="secondary">Connect Google Calendar</button>
          </a>
          <button onClick={() => void handleCalendarSync()} disabled={syncLoading} className="secondary">
            {syncLoading ? 'Syncing…' : 'Sync now'}
          </button>
        </div>
        {syncResult && (
          <p style={{ marginTop: '0.75rem', fontSize: '0.875rem', color: 'var(--text-muted)' }}>{syncResult}</p>
        )}
      </div>

      {/* iOS install */}
      <div className="card" style={{ marginBottom: '1rem' }}>
        <h2 style={{ fontSize: '1rem', marginBottom: '0.5rem' }}>Install on iOS</h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', lineHeight: 1.6 }}>
          To install Departarr on your iPhone or iPad:<br />
          1. Open this page in <strong>Safari</strong><br />
          2. Tap the <strong>Share</strong> button (box with arrow)<br />
          3. Tap <strong>Add to Home Screen</strong><br />
          4. Push notifications require iOS 16.4 or later
        </p>
      </div>
    </>
  )
}
