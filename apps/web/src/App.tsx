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
import { TripViewPage } from './pages/TripView'
import { SharePage } from './pages/Share'
import { SettingsPage } from './pages/Settings'

function RequireAuth({ children }: { children: React.ReactNode }): React.ReactElement {
  const { data: user, isLoading } = useQuery({
    queryKey: ['me'],
    queryFn: api.auth.me,
    retry: false,
  })

  if (isLoading) return <div className="loading">Loading…</div>
  if (!user) return <Navigate to="/login" replace />
  return <>{children}</>
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
        <Route path="/trips/:id" element={<TripViewPage />} />
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
