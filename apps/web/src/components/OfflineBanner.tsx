import { useOffline } from '../lib/offlineContext'

export function OfflineBanner(): React.ReactElement | null {
  const { isOffline } = useOffline()

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '8px',
        padding: '8px 16px',
        background: 'var(--card-bg)',
        borderTop: '1px solid var(--border)',
        color: 'var(--text-muted)',
        fontSize: '12px',
        opacity: isOffline ? 1 : 0,
        pointerEvents: isOffline ? 'auto' : 'none',
        transition: 'opacity 0.3s ease',
      }}
      aria-hidden={!isOffline}
    >
      <span
        style={{
          display: 'inline-block',
          width: '6px',
          height: '6px',
          borderRadius: '50%',
          background: 'var(--text-muted)',
          animation: isOffline ? 'offlinePulse 2s ease-in-out infinite' : 'none',
        }}
      />
      Offline Mode — Viewing cached data. Live updates will resume when connection is restored.
      <style>{`
        @keyframes offlinePulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      `}</style>
    </div>
  )
}
