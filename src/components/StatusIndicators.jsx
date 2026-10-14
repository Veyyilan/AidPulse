import React from 'react'

// Maps need type to marker shape class
const SHAPE_MAP = {
  Medical: 'circle',
  Water:   'square',
  Shelter: 'triangle',
  Food:    'diamond',
}

export function NeedTypeShape({ needType, filled = false, size = 12 }) {
  const shape = SHAPE_MAP[needType] || 'square'
  if (shape === 'triangle') {
    return (
      <span
        style={{
          display: 'inline-block',
          width: 0, height: 0,
          borderLeft: `${size * 0.6}px solid transparent`,
          borderRight: `${size * 0.6}px solid transparent`,
          borderBottom: `${size}px solid ${filled ? 'var(--ink)' : 'transparent'}`,
          ...(filled ? {} : { borderBottomColor: 'var(--ink)', filter: 'none' }),
          flexShrink: 0,
        }}
      />
    )
  }
  return (
    <span
      className={`marker-shape ${shape} ${filled ? 'filled' : ''}`}
      style={{ width: size, height: size }}
    />
  )
}

export function StatusLabel({ status }) {
  const labels = {
    pending:  'PENDING',
    claimed:  'CLAIMED',
    resolved: 'RESOLVED',
    queued:   'QUEUED',
  }
  return (
    <span className={`status-label ${status || 'pending'}`}>
      {labels[status] || status?.toUpperCase() || 'UNKNOWN'}
    </span>
  )
}

export function NeedTypeBadge({ needType }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
      <NeedTypeShape needType={needType} />
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', letterSpacing: '0.06em' }}>
        {needType?.toUpperCase()}
      </span>
    </span>
  )
}
