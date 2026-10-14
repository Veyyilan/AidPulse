import React from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth }     from './context/AuthContext'
import { OfflineProvider, useOffline } from './context/OfflineContext'
import { SocketProvider }            from './context/SocketContext'
import ProtectedRoute                from './components/ProtectedRoute'
import Nav                           from './components/Nav'
import Footer                        from './components/Footer'
import ForcePasswordChange           from './components/ForcePasswordChange'

import LoginPage      from './pages/LoginPage'
import CitizenPage    from './pages/CitizenPage'
import NGOPage        from './pages/NGOPage'
import GovernmentPage from './pages/GovernmentPage'

function OfflineBanner() {
  const { isOnline, queue } = useOffline()
  if (isOnline) return null
  return (
    <div className="offline-banner">
      OFFLINE
      {queue.length > 0
        ? ` · ${queue.length} REPORT${queue.length > 1 ? 'S' : ''} SAVED — WILL SEND WHEN SIGNAL RETURNS`
        : ' · NO NETWORK CONNECTION'}
    </div>
  )
}

function RootRedirect() {
  const { user } = useAuth()
  if (!user) return <Navigate to="/login" replace />
  const routes = { citizen: '/citizen', ngo: '/ngo', government: '/government' }
  return <Navigate to={routes[user.role] || '/citizen'} replace />
}

function AppShell() {
  const { user } = useAuth()
  // Government-provisioned NGOs (and the government account) must change the
  // temporary password before any other route is allowed.
  if (user?.mustChangePassword) {
    return (
      <>
        <Nav />
        <main><ForcePasswordChange /></main>
      </>
    )
  }
  return (
    <>
      <OfflineBanner />
      {user && <Nav />}
      <main>
        <Routes>
          <Route path="/login" element={<LoginPage />} />

          <Route path="/citizen" element={
            <ProtectedRoute roles={['citizen']}>
              <CitizenPage />
            </ProtectedRoute>
          } />

          <Route path="/ngo" element={
            <ProtectedRoute roles={['ngo']}>
              <NGOPage />
            </ProtectedRoute>
          } />

          <Route path="/government" element={
            <ProtectedRoute roles={['government']}>
              <GovernmentPage />
            </ProtectedRoute>
          } />

          <Route path="*" element={<RootRedirect />} />
        </Routes>
      </main>
      {user && <Footer />}
    </>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <OfflineProvider>
          <SocketProvider>
            <AppShell />
          </SocketProvider>
        </OfflineProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}
