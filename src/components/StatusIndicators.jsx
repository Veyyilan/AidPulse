import React from 'react'
import { NEED_SHAPES, NEED_STATUS_LABELS, NEED_LABELS } from '../utils/domain'

// ─── Shape for a need type ───────────────────────────────────────────────────
export function NeedShape({ needType, size = 14, filled = false, style = {} }) {
  const shape = NEED_SHAPES[needType] || 'square'
  const half  = size / 2

  const baseStyle = {
    display: 'inline-block',
    flexShrink: 0,
    border: `2px solid var(--ink)`,
    background: filled ? 'var(--ink)' : 'transparent',
    ...style,
  }

  if (shape === 'circle') {
    return <span style={{ ...baseStyle, width: size, height: size, borderRadius: '50%' }} />
  }
  if (shape === 'triangle') {
    return (
      <span style={{
        display: 'inline-block',
        width: 0, height: 0,
        borderLeft: `${half}px solid transparent`,
        borderRight: `${half}px solid transparent`,
        borderBottom: `${size}px solid ${filled ? 'var(--ink)' : 'transparent'}`,
        outline: !filled ? `2px solid var(--ink)` : 'none',
        flexShrink: 0,
        ...style,
      }} />
    )
  }
  if (shape === 'diamond') {
    return <span style={{ ...baseStyle, width: size, height: size, transform: 'rotate(45deg)' }} />
  }
  // square
  return <span style={{ ...baseStyle, width: size, height: size }} />
}

// ─── Need type badge ─────────────────────────────────────────────────────────
export function NeedBadge({ needType, size = 13 }) {
  const filled = false
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
      <NeedShape needType={needType} size={size} filled={filled} />
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', letterSpacing: '0.06em' }}>
        {NEED_LABELS[needType] || needType?.toUpperCase()}
      </span>
    </span>
  )
}

// ─── Status label ────────────────────────────────────────────────────────────
export function StatusLabel({ status, size = '0.6875rem' }) {
  const isFilled  = status === 'claimed' || status === 'on_the_way' || status === 'in_progress'
  const isHatched = status === 'resolved'
  const isDashed  = status === 'sent' || status === 'pending' || status === '_queued'

  const bg = isHatched
    ? 'repeating-linear-gradient(45deg, var(--ink) 0, var(--ink) 1px, transparent 0, transparent 4px)'
    : isFilled ? 'var(--ink)' : 'transparent'

  return (
    <span style={{
      fontFamily: 'var(--font-mono)',
      fontSize: size,
      letterSpacing: '0.07em',
      textTransform: 'uppercase',
      padding: '0.15rem 0.4rem',
      border: `1px ${isDashed ? 'dashed' : 'solid'} var(--ink)`,
      background: bg,
      color: (isFilled || isHatched) ? 'var(--paper)' : 'var(--ink)',
      display: 'inline-block',
      whiteSpace: 'nowrap',
    }}>
      {NEED_STATUS_LABELS[status] || status?.replace(/_/g, ' ') || 'Unknown'}
    </span>
  )
}

// ─── Per-need status row ─────────────────────────────────────────────────────
export function NeedStatusRow({ need, showLabel = true }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
      <NeedShape
        needType={need.needType}
        size={12}
        filled={need.status === 'claimed' || need.status === 'on_the_way' || need.status === 'resolved'}
      />
      {showLabel && (
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', letterSpacing: '0.05em' }}>
          {NEED_LABELS[need.needType] || need.needType?.toUpperCase()}
        </span>
      )}
      <StatusLabel status={need.status} />
    </span>
  )
}
