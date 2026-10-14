import React from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function ProtectedRoute({ roles = [], children }) {
  const { user, loading } = useAuth()
  if (loading) return <div style={{ padding: '3rem', fontFamily: 'var(--font-mono)', fontSize: '0.75rem', opacity: 0.4 }}>Loading…</div>
  if (!user)   return <Navigate to="/login" replace />
  if (roles.length && !roles.includes(user.role)) {
    const routes = { citizen: '/citizen', ngo: '/ngo', government: '/government' }
    return <Navigate to={routes[user.role] || '/login'} replace />
  }
  return children
}
