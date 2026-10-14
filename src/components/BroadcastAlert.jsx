import React, { useState, useEffect } from 'react'

export default function BroadcastAlert() {
  const [advisory, setAdvisory] = useState(() => {
    try {
      return localStorage.getItem('aidpulse_broadcast_advisory') || ''
    } catch {
      return ''
    }
  })

  useEffect(() => {
    const handleUpdate = (e) => {
      setAdvisory(e.detail || '')
    }
    window.addEventListener('aidpulse:broadcast-advisory', handleUpdate)
    return () => window.removeEventListener('aidpulse:broadcast-advisory', handleUpdate)
  }, [])

  if (!advisory) return null

  return (
    <div style={{
      background: 'var(--ink)',
      color: 'var(--paper)',
      padding: '0.65rem 1.5rem',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '1rem',
      fontSize: '0.8125rem',
      fontFamily: 'var(--font-mono)',
      letterSpacing: '0.04em',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <span>⚠️</span>
        <strong>TAMIL NADU EMERGENCY ADVISORY:</strong>
        <span>{advisory}</span>
      </div>
    </div>
  )
}
