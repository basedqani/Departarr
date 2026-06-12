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
          </div>
        )}
        <div className="settings-row" style={{ cursor: 'pointer' }} onClick={handleLogout}>
          <div className="settings-row-label" style={{ color: 'var(--cancelled)' }}>Sign out</div>
          <ChevronRight />
        </div>
      </div>

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
