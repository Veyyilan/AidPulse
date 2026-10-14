import React, { useState, useCallback, useMemo } from 'react'
import { useAuth } from '../context/AuthContext'
import { useReports } from '../hooks/useReports'
import AidMap, { DEFAULT_TN_CENTER } from '../components/AidMap'
import { NeedBadge, StatusLabel } from '../components/StatusIndicators'
import Toast from '../components/Toast'
import { NEED_LABELS } from '../utils/domain'
import { normalizeReport } from '../utils/domain'

function distLabel(d) {
  if (d == null) return '—'
  return d < 1 ? `${Math.round(d * 1000)} m` : `${d.toFixed(1)} km`
}

// Per-need row within a report — with individual claim/action buttons
function NeedRow({ reportId, need, isMine, onClaim, onMarkInProgress, onResolve, onRelease }) {
  const [busy, setBusy] = useState('')

  const action = async (fn, label) => {
    setBusy(label)
    try { await fn() } finally { setBusy('') }
  }

  const { needType, status, claimedBy } = need

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '0.75rem',
      padding: '0.4rem 0',
      borderBottom: '1px solid color-mix(in srgb, var(--ink) 12%, transparent)',
    }}>
      <NeedBadge needType={needType} />
      <div style={{ flex: 1 }} />
      <StatusLabel status={status} />

      {/* Actions — non-optimistic */}
      {status === 'pending' && (
        <button
          id={`claim-${reportId}-${needType}`}
          type="button"
          className="btn-text"
          disabled={!!busy}
          onClick={() => action(onClaim, 'claiming')}
          style={{ fontSize: '0.8125rem', whiteSpace: 'nowrap' }}
        >
          {busy === 'claiming' ? 'Claiming…' : 'Claim'}
        </button>
      )}

      {status === 'claimed' && isMine && (
        <>
          <button
            type="button"
            className="btn-text"
            disabled={!!busy}
            onClick={() => action(onMarkInProgress, 'progress')}
            style={{ fontSize: '0.75rem', whiteSpace: 'nowrap' }}
          >
            {busy === 'progress' ? '…' : 'In progress'}
          </button>
          <button
            type="button"
            className="btn-text"
            disabled={!!busy}
            onClick={() => action(onResolve, 'resolving')}
            style={{ fontSize: '0.75rem', whiteSpace: 'nowrap' }}
          >
            {busy === 'resolving' ? '…' : 'Resolved'}
          </button>
          <button
            type="button"
            className="btn-text"
            disabled={!!busy}
            onClick={() => action(onRelease, 'releasing')}
            style={{ fontSize: '0.75rem', opacity: 0.5, whiteSpace: 'nowrap' }}
          >
            Release
          </button>
        </>
      )}

      {status === 'in_progress' && isMine && (
        <button
          type="button"
          className="btn-text"
          disabled={!!busy}
          onClick={() => action(onResolve, 'resolving')}
          style={{ fontSize: '0.75rem', whiteSpace: 'nowrap' }}
        >
          {busy === 'resolving' ? '…' : 'Mark resolved'}
        </button>
      )}
    </div>
  )
}

export default function NGOPage() {
  const { user }                                             = useAuth()
  const { reports, claimNeed, releaseNeed, updateNeedStatus } = useReports('ngo')

  const [selectedId, setSelectedId]   = useState(null)
  const [toast, setToast]             = useState(null)

  // Filter to reports with at least one need matching NGO capabilities
  const capabilities = useMemo(() => {
    return (user?.capabilities || []).map(c => c.toLowerCase())
  }, [user])

  // Show reports that have at least one open need matching this NGO's capabilities
  const visibleReports = useMemo(() => {
    const normalized = reports.map(normalizeReport).filter(Boolean)
    return normalized
      .filter(r => {
        if (!r.lat || !r.lng) return false
        // At least one need is relevant and not resolved
        const relevantNeeds = (r.needs || []).filter(n =>
          (capabilities.length === 0 || capabilities.includes(n.needType)) &&
          n.status !== 'resolved'
        )
        return relevantNeeds.length > 0
      })
      .sort((a, b) => (a.distance ?? 999) - (b.distance ?? 999))
  }, [reports, capabilities])

  const makeHandlers = useCallback((reportId, needType) => ({
    onClaim: async () => {
      const res = await claimNeed(reportId, needType)
      if (res.alreadyClaimed) setToast('Already claimed by another responder.')
      else setToast('Claimed.')
    },
    onMarkInProgress: async () => {
      await updateNeedStatus(reportId, needType, 'in_progress')
      setToast('Marked in progress.')
    },
    onResolve: async () => {
      await updateNeedStatus(reportId, needType, 'resolved')
      setToast('Marked resolved.')
    },
    onRelease: async () => {
      await releaseNeed(reportId, needType)
      setToast('Released.')
    },
  }), [claimNeed, updateNeedStatus, releaseNeed])

  return (
    <div className="map-split">
      {toast && <Toast message={toast} onDone={() => setToast(null)} />}

      {/* Left: live map */}
      <div style={{ position: 'relative', borderRight: 'var(--rule)' }}>
        <AidMap
          reports={visibleReports}
          center={DEFAULT_TN_CENTER}
          zoom={7}
          height="100%"
          selectedId={selectedId}
          onReportClick={r => setSelectedId(r.id)}
          readOnly
        />
      </div>

      {/* Right: needs feed */}
      <div style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>

        {/* Header */}
        <div style={{
          padding: '0.875rem 1.5rem',
          borderBottom: 'var(--rule)',
          position: 'sticky', top: 0,
          background: 'var(--paper)', zIndex: 10,
        }}>
          <p style={{
            fontFamily: 'var(--font-mono)', fontSize: '0.6875rem',
            letterSpacing: '0.08em', textTransform: 'uppercase', opacity: 0.55,
          }}>
            Pending needs — {visibleReports.length} reports
            {capabilities.length > 0 && ` · ${capabilities.map(c => NEED_LABELS[c] || c).join(', ')}`}
          </p>
        </div>

        {visibleReports.length === 0 ? (
          <div style={{ padding: '3rem 1.5rem', opacity: 0.45, textAlign: 'center' }}>
            <p style={{ fontSize: '0.9375rem', margin: 0, fontWeight: 500 }}>No pending requests</p>
            <p style={{ fontSize: '0.8125rem', marginTop: '0.4rem' }}>
              Incoming reports matching your capabilities will appear here in real-time.
            </p>
          </div>
        ) : (
          <ul className="ruled-list" style={{ margin: 0, padding: '0 1.5rem' }}>
            {visibleReports.map(r => {
              const isSelected = selectedId === r.id
              const relevantNeeds = (r.needs || []).filter(n =>
                capabilities.length === 0 || capabilities.includes(n.needType)
              )

              return (
                <li
                  key={r.id}
                  id={`report-${r.id}`}
                  style={{
                    cursor: 'pointer',
                    background: isSelected
                      ? 'color-mix(in srgb, var(--ink) 5%, transparent)'
                      : 'transparent',
                  }}
                  onClick={() => setSelectedId(r.id)}
                >
                  {/* Location + distance */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                    <code style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', opacity: 0.5 }}>
                      {r.lat?.toFixed(4)}, {r.lng?.toFixed(4)}
                      {r.accuracyMeters != null ? ` ±${r.accuracyMeters}m` : ''}
                    </code>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', opacity: 0.55 }}>
                      {distLabel(r.distance)}
                    </span>
                  </div>

                  {/* Per-need rows */}
                  {relevantNeeds.map(need => {
                    const isMine = need.claimedBy === user?.id
                    const handlers = makeHandlers(r.id, need.needType)
                    return (
                      <NeedRow
                        key={need.needType}
                        reportId={r.id}
                        need={need}
                        isMine={isMine}
                        {...handlers}
                      />
                    )
                  })}

                  <span style={{ fontSize: '0.7rem', opacity: 0.35, display: 'block', marginTop: '0.4rem' }}>
                    {new Date(r.createdAt).toLocaleString('en-IN', {
                      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                    })}
                  </span>
                </li>
              )
            })}
          </ul>
        )}

        {/* Legend */}
        <div style={{ marginTop: 'auto', padding: '0.875rem 1.5rem', borderTop: 'var(--rule)' }}>
          <p style={{
            fontFamily: 'var(--font-mono)', fontSize: '0.6rem',
            letterSpacing: '0.08em', textTransform: 'uppercase', opacity: 0.35,
          }}>
            ○ Medical · △ Rescue · □ Food · ◇ Shelter · Filled = Claimed/Active
          </p>
        </div>
      </div>
    </div>
  )
}