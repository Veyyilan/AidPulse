import React from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function ProtectedRoute({ children, roles }) {
  const { user, loading } = useAuth()

  if (loading) {
    return (
      <div style={{ padding: '3rem 1.5rem' }}>
        <span className="skeleton" style={{ width: 200 }} />
      </div>
    )
  }

  if (!user) return <Navigate to="/login" replace />

  if (roles && !roles.includes(user.role)) {
    // Redirect to their own dashboard
    const routes = { citizen: '/citizen', ngo: '/ngo', government: '/government', admin: '/admin' }
    return <Navigate to={routes[user.role] || '/citizen'} replace />
  }

  return children
}
