import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from './lib/api'
import { useFlightUpdates } from './hooks/useFlightUpdates'
import { Layout } from './components/Layout'
import { LoginPage } from './pages/Login'
import { RegisterPage } from './pages/Register'
import { TodayPage } from './pages/Today'
import { UpcomingPage } from './pages/Upcoming'
import { PastPage } from './pages/Past'
import { FlightDetailPage } from './pages/FlightDetail'
import { AddFlightPage } from './pages/AddFlight'
import { TripDetailPage } from './pages/TripDetail'
import { SharePage } from './pages/Share'
import { SettingsPage } from './pages/Settings'

function RequireAuth({ children }: { children: React.ReactNode }): React.ReactElement {
  const hasToken = typeof window !== 'undefined' && !!localStorage.getItem('token')

  const { data: user, isError, fetchStatus } = useQuery({
    queryKey: ['me'],
    queryFn: api.auth.me,
    retry: false,
    staleTime: 0,
    refetchOnMount: 'always',
    enabled: hasToken,
  })

  // No token at all → straight to login.
  if (!hasToken) return <Navigate to="/login" replace />
  // Authenticated.
  if (user) return <>{children}</>
  // Still resolving (cache restore or in-flight request) — DON'T bounce to
  // login yet. react-query reports isLoading:false while idle-pending during
  // the persist-restore window, which previously caused a login redirect loop.
  if (fetchStatus === 'fetching' || !isError) return <div className="loading">Loading…</div>
  // Token present but /me definitively failed (e.g. expired) → login.
  return <Navigate to="/login" replace />
}

function AuthenticatedApp(): React.ReactElement {
  useFlightUpdates()
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Navigate to="/today" replace />} />
        <Route path="/today" element={<TodayPage />} />
        <Route path="/upcoming" element={<UpcomingPage />} />
        <Route path="/past" element={<PastPage />} />
        <Route path="/flights/add" element={<AddFlightPage />} />
        <Route path="/flights/:id" element={<FlightDetailPage />} />
        <Route path="/trips/:id" element={<TripDetailPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Routes>
    </Layout>
  )
}

export default function App(): React.ReactElement {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/share/:token" element={<SharePage />} />
        <Route
          path="/*"
          element={
            <RequireAuth>
              <AuthenticatedApp />
            </RequireAuth>
          }
        />
      </Routes>
    </BrowserRouter>
  )
}
