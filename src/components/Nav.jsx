import React from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useOffline } from '../context/OfflineContext'

const ROLE_LABELS = {
  citizen:    'Citizen',
  ngo:        'NGO / Volunteer',
  government: 'Government',
  admin:      'System Admin',
}

export default function Nav() {
  const { user, logout } = useAuth()
  const { isOnline, queue } = useOffline()
  const navigate = useNavigate()

  const handleLogout = () => { logout(); navigate('/login') }

  if (!user) return null

  return (
    <nav className="app-nav">
      <Link to="/" className="wordmark">AidPulse</Link>

      <div style={{ display: 'flex', alignItems: 'center', gap: '2rem' }}>
        {!isOnline && (
          <span className="mono" style={{ fontSize: '0.6875rem', opacity: 0.6 }}>
            OFFLINE{queue.length > 0 ? ` · ${queue.length} QUEUED` : ''}
          </span>
        )}
        <span style={{ fontSize: '0.8125rem', opacity: 0.55 }}>
          {ROLE_LABELS[user.role]} — {user.name}
        </span>
        <button className="btn-text" onClick={handleLogout} style={{ fontSize: '0.8125rem' }}>
          Sign out
        </button>
      </div>
    </nav>
  )
}
