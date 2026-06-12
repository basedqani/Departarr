import { useState, type FormEvent } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { api, setToken } from '../lib/api'

function PlaneWordmark(): React.ReactElement {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '0.625rem',
      fontSize: '1.5rem',
      fontWeight: 800,
      letterSpacing: '-0.03em',
      marginBottom: '0.3rem',
      color: 'var(--text)',
    }}>
      <svg width="28" height="28" viewBox="0 0 24 24" fill="var(--accent)">
        <path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z" />
      </svg>
      Departarr
    </div>
  )
}

export function RegisterPage(): React.ReactElement {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await api.auth.register({ name, email, password })
      setToken(res.token)
      queryClient.setQueryData(['me'], res.user)
      navigate('/today')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-page">
      <div style={{
        position: 'fixed', inset: 0, pointerEvents: 'none', overflow: 'hidden', zIndex: 0,
        background: 'radial-gradient(ellipse at 50% 0%, rgba(77,168,255,0.06) 0%, transparent 60%)',
      }} />

      <motion.div
        className="auth-card"
        initial={{ opacity: 0, y: 20, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.3, ease: [0.25, 0.46, 0.45, 0.94] }}
        style={{ position: 'relative', zIndex: 1 }}
      >
        <PlaneWordmark />
        <p style={{ color: 'var(--text-muted)', marginBottom: '1.75rem', fontSize: '0.875rem' }}>
          Create your account
        </p>

        {error && <div className="error-box">{error}</div>}

        <form onSubmit={(e) => void handleSubmit(e)}>
          <div className="form-group">
            <label>Name</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              required
              autoComplete="name"
              placeholder="Your name"
            />
          </div>
          <div className="form-group">
            <label>Email</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              autoComplete="email"
              placeholder="you@example.com"
            />
          </div>
          <div className="form-group">
            <label>Password</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              minLength={8}
              autoComplete="new-password"
              placeholder="Min. 8 characters"
            />
          </div>
          <button type="submit" disabled={loading} style={{ width: '100%', padding: '0.8rem', marginTop: '0.25rem' }}>
            {loading ? (
              <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
                <span className="loading-spinner" style={{ width: 16, height: 16 }} />
                Creating account…
              </span>
            ) : 'Create account'}
          </button>
        </form>

        <p style={{ textAlign: 'center', marginTop: '1.25rem', fontSize: '0.875rem', color: 'var(--text-muted)' }}>
          Already have an account? <Link to="/login">Sign in</Link>
        </p>
      </motion.div>
    </div>
  )
}
