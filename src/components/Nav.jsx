import React from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useOffline } from '../context/OfflineContext'
import { useSocket } from '../context/SocketContext'
import { useTranslation } from 'react-i18next'

const ROLE_LABELS = {
  citizen:    'Citizen',
  ngo:        'NGO Responder',
  government: 'Government',
}

export default function Nav() {
  const { user, logout }      = useAuth()
  const { isOnline, queue }   = useOffline()
  const { connected }         = useSocket()
  const navigate              = useNavigate()
  const { t, i18n }           = useTranslation()

  if (!user) return null

  const handleLogout = () => { logout(); navigate('/login') }

  const toggleLang = () => {
    const next = i18n.language.startsWith('ta') ? 'en' : 'ta'
    i18n.changeLanguage(next)
    localStorage.setItem('aidpulse-lang', next)
  }

  return (
    <nav className="app-nav">
      <Link to="/" className="wordmark">AidPulse</Link>

      <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
        {/* Socket status — only show when disconnected and online */}
        {isOnline && !connected && (
          <span style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '0.625rem',
            letterSpacing: '0.06em',
            opacity: 0.5,
            borderBottom: '1px dashed var(--ink)',
          }}>
            RECONNECTING
          </span>
        )}

        {/* Offline indicator with queued count */}
        {!isOnline && (
          <span style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '0.625rem',
            letterSpacing: '0.06em',
            opacity: 0.75,
          }}>
            OFFLINE{queue.length > 0 ? ` · ${queue.length} QUEUED` : ''}
          </span>
        )}

        {/* User info */}
        {user.name && (
          <span style={{ fontSize: '0.8125rem', opacity: 0.55 }}>
            {ROLE_LABELS[user.role] || user.role} — {user.name}
          </span>
        )}

        <button className="lang-toggle" onClick={toggleLang} aria-label="Toggle language">
          {t('toggleLang')}
        </button>

        <button
          className="btn-text"
          onClick={handleLogout}
          style={{ fontSize: '0.8125rem' }}
        >
          {t('signOut')}
        </button>
      </div>
    </nav>
  )
}
