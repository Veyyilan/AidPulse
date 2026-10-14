import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { useAuth } from '../context/AuthContext'
import { useReports } from '../hooks/useReports'
import { useSocket } from '../context/SocketContext'
import AidMap, { DEFAULT_TN_CENTER } from '../components/AidMap'
import { NeedBadge, StatusLabel } from '../components/StatusIndicators'
import Toast from '../components/Toast'
import { govApi } from '../api/endpoints'
import { NEED_TYPES, NEED_LABELS, NGO_CAPABILITIES, normalizeReport } from '../utils/domain'

const REPORT_STATUSES = ['pending', 'claimed', 'in_progress', 'resolved']

// ─── Stats strip ─────────────────────────────────────────────────────────────
function StatsStrip({ stats }) {
  if (!stats) return (
    <div className="stats-strip">
      {[1,2,3,4,5].map(i => (
        <div key={i} className="stat">
          <span className="skeleton" style={{ width: 60, marginBottom: 4 }} />
          <span className="skeleton" style={{ width: 40, height: '1.6rem' }} />
        </div>
      ))}
    </div>
  )

  const items = [
    { label: 'Total',    value: stats.totalReports ?? 0 },
    { label: 'Pending',  value: stats.pending ?? 0 },
    { label: 'Claimed',  value: stats.claimed ?? 0 },
    { label: 'Resolved', value: stats.resolved ?? 0 },
    { label: 'Gaps',     value: stats.coverageGaps ?? 0 },
  ]
  return (
    <div className="stats-strip">
      {items.map(({ label, value }) => (
        <div key={label} className="stat">
          <p style={{
            fontFamily: 'var(--font-mono)', fontSize: '0.625rem',
            letterSpacing: '0.1em', textTransform: 'uppercase',
            opacity: 0.45, marginBottom: '0.25rem',
          }}>
            {label}
          </p>
          <p style={{ fontFamily: 'var(--font-serif)', fontSize: '1.75rem', fontWeight: 400, lineHeight: 1 }}>
            {value}
          </p>
        </div>
      ))}
    </div>
  )
}

// ─── Gap alerts list ──────────────────────────────────────────────────────────
function GapAlerts({ gaps }) {
  if (!gaps.length) return (
    <div style={{ padding: '2rem', opacity: 0.4, textAlign: 'center' }}>
      <p style={{ fontSize: '0.875rem' }}>No coverage gaps detected.</p>
    </div>
  )
  return (
    <ul className="ruled-list" style={{ padding: '0 1.5rem' }}>
      {gaps.map(g => {
        const hasCoords = g.lat != null && g.lng != null
        return (
          <li key={g.cellKey || `${g.lat},${g.lng}`} style={{ fontSize: '0.875rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <code style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem' }}>
                {hasCoords ? `${Number(g.lat).toFixed(4)}, ${Number(g.lng).toFixed(4)}` : g.cellKey}
              </code>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', opacity: 0.6 }}>
                {g.count} pending
                {g.thresholdMinutes != null ? ` · >${g.thresholdMinutes} min` : ''}
              </span>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.4rem', flexWrap: 'wrap' }}>
              {(g.needTypes || []).map(nt => (
                <NeedBadge key={nt} needType={nt} />
              ))}
            </div>
          </li>
        )
      })}
    </ul>
  )
}

// ─── Cluster / merge list ─────────────────────────────────────────────────────
function ClusterList({ reports, onForceRelease, releasing = {} }) {
  const clusters = useMemo(() => {
    return reports
      .filter(r => r.duplicateCount > 0)
      .sort((a, b) => b.duplicateCount - a.duplicateCount)
  }, [reports])

  if (!clusters.length) return (
    <div style={{ padding: '2rem', opacity: 0.4, textAlign: 'center' }}>
      <p style={{ fontSize: '0.875rem' }}>No merged clusters yet.</p>
    </div>
  )
  return (
    <div style={{ overflowX: 'auto', padding: '0 1.5rem' }}>
      <table className="data-table">
        <thead>
          <tr>
            <th>Location</th>
            <th>Needs</th>
            <th>Similar reports</th>
            <th>Status</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {clusters.map(r => {
            const hasActive = (r.needs || []).some(
              n => n.status === 'claimed' || n.status === 'in_progress'
            )
            return (
              <tr key={r.id}>
                <td>
                  <code style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem' }}>
                    {Number(r.lat).toFixed(4)}, {Number(r.lng).toFixed(4)}
                  </code>
                </td>
                <td>
                  <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                    {(r.needs || []).map(n => <NeedBadge key={n.needType} needType={n.needType} />)}
                  </div>
                </td>
                <td style={{ fontFamily: 'var(--font-serif)', fontSize: '1.2rem' }}>
                  +{r.duplicateCount}
                </td>
                <td><StatusLabel status={r.status} /></td>
                <td>
                  {hasActive ? (
                    <button
                      type="button"
                      className="btn-text"
                      disabled={!!releasing[r.id]}
                      onClick={() => onForceRelease?.(r.id)}
                      style={{ fontSize: '0.75rem', whiteSpace: 'nowrap' }}
                    >
                      {releasing[r.id] ? '…' : 'Force release'}
                    </button>
                  ) : (
                    <span style={{ opacity: 0.3, fontSize: '0.8125rem' }}>—</span>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ─── Register NGO modal ────────────────────────────────────────────────────────
function RegisterNgoModal({ onCreated, onClose }) {
  const [name,         setName]         = useState('')
  const [email,        setEmail]        = useState('')
  const [password,     setPassword]     = useState('')
  const [orgName,      setOrgName]      = useState('')
  const [phone,        setPhone]        = useState('')
  const [capabilities, setCapabilities] = useState([])  // string[]
  const [loading,      setLoading]      = useState(false)
  const [err,          setErr]          = useState('')

  const toggleCap = (cap) =>
    setCapabilities(prev => prev.includes(cap) ? prev.filter(c => c !== cap) : [...prev, cap])

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!capabilities.length) { setErr('Select at least one capability.'); return }
    setLoading(true); setErr('')
    try {
      const res = await govApi.createNgo({
        name,
        email,
        password: password || undefined,
        organizationName: orgName || undefined,
        phone: phone || undefined,
        capabilities,
      })
      onCreated(res.data)
      onClose()
    } catch (err) {
      setErr(err.response?.data?.error || err.message || 'Registration failed.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(17,17,17,0.6)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 500, padding: '1rem',
    }}>
      <div style={{
        background: 'var(--paper)', border: 'var(--rule)',
        padding: '2rem', maxWidth: 440, width: '100%',
        maxHeight: '90dvh', overflowY: 'auto',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
          <h3 style={{ margin: 0 }}>Register NGO account</h3>
          <button type="button" className="btn-text" onClick={onClose} style={{ fontSize: '1.1rem', lineHeight: 1 }}>✕</button>
        </div>

        {err && <p style={{ fontSize: '0.8125rem', fontWeight: 500, marginBottom: '1rem' }}>{err}</p>}

        <form onSubmit={handleSubmit}>
          {[
            { id: 'ngo-name',    label: 'Representative name',      val: name,    set: setName,    type: 'text' },
            { id: 'ngo-org',     label: 'Organization name',        val: orgName, set: setOrgName, type: 'text' },
            { id: 'ngo-email',   label: 'Email address',            val: email,   set: setEmail,   type: 'email' },
            { id: 'ngo-phone',   label: 'Contact phone (optional)', val: phone,   set: setPhone,   type: 'tel' },
            { id: 'ngo-pwd',     label: 'Temporary password (min. 8 chars, optional)', val: password, set: setPassword, type: 'password' },
          ].map(({ id, label, val, set, type }) => (
            <div key={id} style={{ marginBottom: '1.25rem' }}>
              <label className="field-label" htmlFor={id}>{label}</label>
              <input
                id={id}
                type={type}
                required={!['ngo-phone', 'ngo-pwd'].includes(id)}
                className="input-underline"
                value={val}
                onChange={e => set(e.target.value)}
              />
            </div>
          ))}

          {/* Capabilities */}
          <div style={{ marginBottom: '1.75rem' }}>
            <label className="field-label">Capabilities (select all that apply)</label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0, marginTop: '0.5rem' }}>
              {NGO_CAPABILITIES.map(cap => {
                const sel = capabilities.includes(cap)
                return (
                  <button
                    key={cap}
                    type="button"
                    onClick={() => toggleCap(cap)}
                    style={{
                      padding: '0.6rem 1rem',
                      border: '1px solid var(--ink)', borderRadius: 0,
                      background: sel ? 'var(--ink)' : 'transparent',
                      color:      sel ? 'var(--paper)' : 'var(--ink)',
                      fontFamily: 'var(--font-mono)', fontSize: '0.75rem',
                      letterSpacing: '0.05em', textTransform: 'uppercase',
                      cursor: 'pointer', marginTop: '-1px', marginLeft: '-1px',
                    }}
                  >
                    {NEED_LABELS[cap] || cap}
                  </button>
                )
              })}
            </div>
          </div>

          <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end' }}>
            <button type="button" className="btn-text" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-solid" disabled={loading}>
              {loading ? 'Registering…' : 'Create NGO account'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Main government page ─────────────────────────────────────────────────────
export default function GovernmentPage() {
  const { user }              = useAuth()
  const { reports, refresh }  = useReports('government')
  const { gaps }              = useSocket()

  const [tab,          setTab]          = useState('map')  // 'map' | 'gaps' | 'clusters' | 'ngos'
  const [ngos,         setNgos]         = useState([])
  const [gapCells,     setGapCells]     = useState([])
  const [showNgoModal, setShowNgoModal] = useState(false)
  const [toast,        setToast]        = useState(null)
  const [statusFilter, setStatusFilter] = useState('')
  const [needFilter,   setNeedFilter]   = useState('')
  const [busyIds,      setBusyIds]      = useState({})

  useEffect(() => {
    let cancelled = false
    govApi.listNgos()
      .then(r => { if (!cancelled) setNgos(Array.isArray(r.data) ? r.data : []) })
      .catch(() => { if (!cancelled) setNgos([]) })
    govApi.gaps()
      .then(r => { if (!cancelled) setGapCells(Array.isArray(r.data) ? r.data : []) })
      .catch(() => { if (!cancelled) setGapCells([]) })
    return () => { cancelled = true }
  }, [])

  const normalizedReports = useMemo(() => reports.map(normalizeReport).filter(Boolean), [reports])

  const filteredReports = useMemo(() => {
    return normalizedReports.filter(r => {
      if (statusFilter && r.status !== statusFilter) return false
      if (needFilter  && !(r.needs || []).some(n => n.needType === needFilter)) return false
      return true
    })
  }, [normalizedReports, statusFilter, needFilter])

  // Merge the gap cells fetched at load with any live gap:alert events.
  const mergedGaps = useMemo(() => {
    const byKey = new Map()
    for (const g of gapCells) byKey.set(g.cellKey || `${g.lat},${g.lng}`, g)
    for (const g of gaps)     byKey.set(g.cellKey || `${g.lat},${g.lng}`, g)
    return [...byKey.values()].sort((a, b) => (b.count ?? 0) - (a.count ?? 0))
  }, [gapCells, gaps])

  // There is no /gov stats endpoint — derive the strip from the reports we hold.
  const stats = useMemo(() => ({
    totalReports: normalizedReports.length,
    pending:  normalizedReports.filter(r => r.status === 'pending').length,
    claimed:  normalizedReports.filter(r => r.status === 'claimed' || r.status === 'in_progress').length,
    resolved: normalizedReports.filter(r => r.status === 'resolved').length,
    coverageGaps: mergedGaps.length,
  }), [normalizedReports, mergedGaps])

  const handleForceRelease = async (reportId) => {
    setBusyIds(p => ({ ...p, [reportId]: 'releasing' }))
    try {
      await govApi.forceRelease(reportId)
      setToast('Stale claims released.')
      refresh()
    } catch {
      setToast('Force release failed — nothing claimed on that report.')
    } finally {
      setBusyIds(p => ({ ...p, [reportId]: '' }))
    }
  }

  const handleSuspend = async (uid) => {
    setBusyIds(p => ({ ...p, [uid]: 'suspending' }))
    try {
      await govApi.suspend(uid)
      setNgos(prev => prev.map(u => u.id === uid ? { ...u, isSuspended: true } : u))
      setToast('NGO suspended.')
    } catch { setToast('Suspend failed.') }
    finally { setBusyIds(p => ({ ...p, [uid]: '' })) }
  }

  const handleRestore = async (uid) => {
    setBusyIds(p => ({ ...p, [uid]: 'restoring' }))
    try {
      await govApi.restore(uid)
      setNgos(prev => prev.map(u => u.id === uid ? { ...u, isSuspended: false } : u))
      setToast('NGO restored.')
    } catch { setToast('Restore failed.') }
    finally { setBusyIds(p => ({ ...p, [uid]: '' })) }
  }

  const TABS = [
    { id: 'map',      label: 'Live map' },
    { id: 'gaps',     label: `Gaps ${mergedGaps.length > 0 ? `(${mergedGaps.length})` : ''}` },
    { id: 'clusters', label: 'Clusters' },
    { id: 'ngos',     label: `NGOs (${ngos.length})` },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100dvh - 52px)' }}>
      {toast && <Toast message={toast} onDone={() => setToast(null)} />}
      {showNgoModal && (
        <RegisterNgoModal
          onCreated={({ ngo, tempPassword }) => {
            setNgos(p => [ngo, ...p])
            setToast(tempPassword
              ? `NGO ${ngo.name} created — temporary password: ${tempPassword}`
              : `NGO ${ngo.name} created.`)
          }}
          onClose={() => setShowNgoModal(false)}
        />
      )}

      <StatsStrip stats={stats} />

      {/* Tab bar */}
      <div style={{
        display: 'flex', alignItems: 'center',
        justifyContent: 'space-between',
        borderBottom: 'var(--rule)', padding: '0 1.5rem',
        background: 'var(--paper)', flexShrink: 0,
      }}>
        <div style={{ display: 'flex', gap: '2rem' }}>
          {TABS.map(t => (
            <button
              key={t.id}
              type="button"
              id={`gov-tab-${t.id}`}
              className="btn-text"
              onClick={() => setTab(t.id)}
              style={{
                padding: '0.875rem 0',
                borderBottom: tab === t.id ? '2px solid var(--ink)' : '2px solid transparent',
                fontWeight: tab === t.id ? 500 : 400,
                fontSize: '0.875rem',
                borderRadius: 0,
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'ngos' && (
          <button
            type="button"
            id="gov-create-ngo"
            className="btn-solid"
            onClick={() => setShowNgoModal(true)}
            style={{ padding: '0.4rem 1rem', fontSize: '0.8125rem' }}
          >
            + Create NGO
          </button>
        )}
      </div>

      {/* Tab content */}
      {tab === 'map' && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* Filters */}
          <div className="filter-bar">
            <div>
              <label className="field-label" htmlFor="gov-status">Status</label>
              <select id="gov-status" className="select-underline" style={{ minWidth: 130 }}
                value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
                <option value="">All statuses</option>
                {REPORT_STATUSES.map(s => (
                  <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1).replace('_', ' ')}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="field-label" htmlFor="gov-need">Need type</label>
              <select id="gov-need" className="select-underline" style={{ minWidth: 130 }}
                value={needFilter} onChange={e => setNeedFilter(e.target.value)}>
                <option value="">All types</option>
                {NEED_TYPES.map(n => (
                  <option key={n} value={n}>{NEED_LABELS[n]}</option>
                ))}
              </select>
            </div>
            <span style={{ fontSize: '0.8125rem', opacity: 0.45, alignSelf: 'flex-end', paddingBottom: '0.5rem' }}>
              {filteredReports.length} report{filteredReports.length !== 1 ? 's' : ''}
            </span>
          </div>

          <div style={{ flex: 1, position: 'relative' }}>
            <AidMap
              reports={filteredReports}
              center={DEFAULT_TN_CENTER}
              zoom={7}
              height="100%"
              readOnly
            />
          </div>
        </div>
      )}

      {tab === 'gaps' && (
        <div style={{ flex: 1, overflowY: 'auto', padding: '1.5rem 0' }}>
          <h3 style={{ padding: '0 1.5rem', marginBottom: '1rem' }}>Coverage gaps</h3>
          <p style={{ padding: '0 1.5rem', opacity: 0.55, fontSize: '0.875rem', marginBottom: '1.5rem' }}>
            Areas with multiple unresolved reports and no NGO response detected via real-time analysis.
          </p>
          <GapAlerts gaps={mergedGaps} />
        </div>
      )}

      {tab === 'clusters' && (
        <div style={{ flex: 1, overflowY: 'auto', padding: '1.5rem 0' }}>
          <h3 style={{ padding: '0 1.5rem', marginBottom: '1rem' }}>Merged report clusters</h3>
          <p style={{ padding: '0 1.5rem', opacity: 0.55, fontSize: '0.875rem', marginBottom: '1.5rem' }}>
            Reports within 150 m of each other are grouped. Original reports are preserved — nothing is deleted.
          </p>
          <ClusterList reports={normalizedReports} onForceRelease={handleForceRelease} releasing={busyIds} />
        </div>
      )}

      {tab === 'ngos' && (
        <div style={{ flex: 1, overflowY: 'auto', padding: '1.5rem' }}>
          <h3 style={{ marginBottom: '1.25rem' }}>Registered NGOs</h3>
          {ngos.length === 0 ? (
            <div style={{ opacity: 0.45, padding: '2rem 0', textAlign: 'center' }}>
              <p style={{ fontSize: '0.9375rem' }}>No NGO accounts yet. Create one above.</p>
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Organization</th>
                    <th>Contact</th>
                    <th>Email</th>
                    <th>Capabilities</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {ngos.map(u => (
                    <tr key={u.id} style={{ opacity: u.isSuspended ? 0.5 : 1 }}>
                      <td style={{ fontWeight: 500 }}>{u.organizationName || u.name}</td>
                      <td>{u.name}</td>
                      <td><code style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem' }}>{u.email}</code></td>
                      <td>
                        <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                          {(u.capabilities || []).map(cap => (
                            <span key={cap} style={{
                              fontFamily: 'var(--font-mono)', fontSize: '0.625rem',
                              letterSpacing: '0.06em', padding: '0.1rem 0.35rem',
                              border: 'var(--rule)', textTransform: 'uppercase',
                            }}>
                              {NEED_LABELS[cap] || cap}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td><StatusLabel status={u.isSuspended ? 'suspended' : 'active'} /></td>
                      <td>
                        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                          {!u.isSuspended ? (
                            <button
                              id={`suspend-${u.id}`}
                              type="button"
                              className="btn-text"
                              disabled={!!busyIds[u.id]}
                              onClick={() => handleSuspend(u.id)}
                              style={{ fontSize: '0.75rem' }}
                            >
                              {busyIds[u.id] === 'suspending' ? '…' : 'Suspend'}
                            </button>
                          ) : (
                            <button
                              id={`restore-${u.id}`}
                              type="button"
                              className="btn-text"
                              disabled={!!busyIds[u.id]}
                              onClick={() => handleRestore(u.id)}
                              style={{ fontSize: '0.75rem' }}
                            >
                              {busyIds[u.id] === 'restoring' ? '…' : 'Restore'}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}