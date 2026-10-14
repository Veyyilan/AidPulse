import React, { useState, useEffect, useRef } from 'react'
import { useAuth } from '../context/AuthContext'
import { useReports } from '../hooks/useReports'
import { useGeolocation, isInsideTN } from '../hooks/useGeolocation'
import { useOffline } from '../context/OfflineContext'
import AidMap, { DEFAULT_TN_CENTER } from '../components/AidMap'
import { NeedShape, StatusLabel } from '../components/StatusIndicators'
import Toast from '../components/Toast'
import { NEED_TYPES, NEED_LABELS, NEED_SHAPES } from '../utils/domain'

// ─── Large need type toggle button ───────────────────────────────────────────
function NeedToggle({ needType, selected, onToggle }) {
  const shape = NEED_SHAPES[needType] || 'square'
  const label = NEED_LABELS[needType] || needType

  return (
    <button
      type="button"
      id={`need-${needType}`}
      onClick={() => onToggle(needType)}
      aria-pressed={selected}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '0.75rem',
        padding: '1.5rem 1rem',
        border: 'var(--rule)',
        borderRadius: 0,
        background: selected ? 'var(--ink)' : 'transparent',
        color:      selected ? 'var(--paper)' : 'var(--ink)',
        cursor: 'pointer',
        transition: 'background 0.12s, color 0.12s',
        minHeight: 100,
        fontFamily: 'var(--font-mono)',
        fontSize: '0.8125rem',
        letterSpacing: '0.07em',
        textTransform: 'uppercase',
      }}
    >
      <NeedShape
        needType={needType}
        size={20}
        filled={selected}
        style={{
          border: `2px solid ${selected ? 'var(--paper)' : 'var(--ink)'}`,
          background: selected ? 'var(--paper)' : 'transparent',
        }}
      />
      {label}
    </button>
  )
}

// ─── Per-need status display ──────────────────────────────────────────────────
function NeedStatusList({ needs }) {
  const STATUS_LABELS = {
    sent:        'Sent — awaiting response',
    pending:     'Pending',
    claimed:     'Claimed',
    on_the_way:  'On the way',
    in_progress: 'In progress',
    resolved:    'Resolved',
  }
  return (
    <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      {needs.map(n => (
        <li key={n.needType} style={{
          display: 'flex', alignItems: 'center', gap: '0.75rem',
          padding: '0.6rem 0',
          borderBottom: '1px solid color-mix(in srgb, var(--ink) 15%, transparent)',
        }}>
          <NeedShape needType={n.needType} size={14} filled={
            n.status === 'claimed' || n.status === 'on_the_way' ||
            n.status === 'in_progress' || n.status === 'resolved'
          } />
          <span style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '0.8125rem',
            letterSpacing: '0.04em',
            flex: 1,
          }}>
            {NEED_LABELS[n.needType] || n.needType?.toUpperCase()}
          </span>
          <StatusLabel status={n.status} />
        </li>
      ))}
    </ul>
  )
}

// ─── My Reports list ──────────────────────────────────────────────────────────
function MyReportsList({ reports, queue }) {
  const queuedReports = queue.map(q => ({
    id: 'q-' + q.id,
    needs: (q.payload?.needs || []).map(nt => ({ needType: nt, status: '_queued' })),
    lat: q.payload?.lat, lng: q.payload?.lng,
    createdAt: q.queuedAt,
    _queued: true,
  }))
  const all = [...queuedReports, ...reports]

  if (all.length === 0) {
    return (
      <div style={{ padding: '3rem 0', opacity: 0.45, textAlign: 'center' }}>
        <p style={{ fontSize: '0.9375rem', margin: 0, fontWeight: 500 }}>No reports yet</p>
        <p style={{ fontSize: '0.8125rem', marginTop: '0.4rem' }}>
          Your submitted reports will appear here with live need-by-need tracking.
        </p>
      </div>
    )
  }

  return (
    <ul className="ruled-list">
      {all.map(r => (
        <li key={r.id}>
          {r._queued && (
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.625rem', opacity: 0.55, marginBottom: '0.4rem', letterSpacing: '0.08em' }}>
              SAVED — WILL SEND WHEN SIGNAL RETURNS
            </p>
          )}
          <NeedStatusList needs={r.needs || []} />
          {r.lat != null && (
            <code style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', opacity: 0.4, display: 'block', marginTop: '0.4rem' }}>
              {Number(r.lat).toFixed(5)}, {Number(r.lng).toFixed(5)}
              {r.accuracyMeters != null ? ` ±${r.accuracyMeters}m` : ''}
            </code>
          )}
          <span style={{ fontSize: '0.7rem', opacity: 0.35, display: 'block', marginTop: '0.2rem' }}>
            {new Date(r.createdAt).toLocaleString('en-IN', {
              day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
            })}
          </span>
        </li>
      ))}
    </ul>
  )
}

// ─── Main citizen page ────────────────────────────────────────────────────────
export default function CitizenPage() {
  const { user }                        = useAuth()
  const { isOnline, queue }             = useOffline()
  const { reports, myReports, submit }  = useReports('citizen')

  const {
    position, loading: geoLoading, error: geoError, warning: geoWarning,
    denied, request: requestGeo, setManual,
  } = useGeolocation()

  const [selectedNeeds, setSelectedNeeds] = useState([])   // string[]
  const [submitting,    setSubmitting]    = useState(false)
  const [toast,         setToast]         = useState(null)
  const [view,          setView]          = useState('form')  // 'form' | 'history'
  const [mapCenter,     setMapCenter]     = useState(DEFAULT_TN_CENTER)
  const [mapZoom,       setMapZoom]       = useState(7)

  // Auto-center map on GPS fix
  useEffect(() => {
    if (position && position.source === 'gps') {
      setMapCenter([position.lat, position.lng])
      setMapZoom(15)
    }
  }, [position])

  const toggleNeed = (nt) => {
    setSelectedNeeds(prev =>
      prev.includes(nt) ? prev.filter(n => n !== nt) : [...prev, nt]
    )
  }

  const canSend = selectedNeeds.length > 0 && !submitting

  const handleSend = async () => {
    if (!canSend) return

    let lat = position?.lat
    let lng = position?.lng

    if (lat == null || lng == null) {
      setToast('Tap the map to place your location pin first.')
      return
    }
    if (!isInsideTN(lat, lng)) {
      setToast('Coordinates outside Tamil Nadu (lat 7.9–13.7, lng 76.1–80.5).')
      return
    }

    setSubmitting(true)
    try {
      const result = await submit({
        needs: selectedNeeds,
        lat, lng,
        accuracyMeters: position?.accuracy ?? null,
      })
      setSelectedNeeds([])
      if (result.queued) {
        setToast('Saved — will send when signal returns.')
      } else {
        setToast('Report sent.')
        setView('history')
      }
    } catch (err) {
      const msg = err?.response?.data?.error || err?.message || 'Send failed. Check your connection.'
      setToast(msg)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      height: 'calc(100dvh - 52px)',
      overflow: 'hidden',
    }}>
      {toast && <Toast message={toast} onDone={() => setToast(null)} />}

      {/* Tab bar */}
      <div style={{
        display: 'flex', borderBottom: 'var(--rule)',
        background: 'var(--paper)', zIndex: 10,
      }}>
        <button
          type="button"
          onClick={() => setView('form')}
          style={{
            flex: 1, padding: '0.75rem',
            fontFamily: 'var(--font-mono)', fontSize: '0.75rem',
            letterSpacing: '0.06em', textTransform: 'uppercase',
            background: view === 'form' ? 'var(--ink)' : 'transparent',
            color: view === 'form' ? 'var(--paper)' : 'var(--ink)',
            border: 'none', borderRight: 'var(--rule)', cursor: 'pointer',
          }}
        >
          Report
        </button>
        <button
          type="button"
          onClick={() => setView('history')}
          style={{
            flex: 1, padding: '0.75rem',
            fontFamily: 'var(--font-mono)', fontSize: '0.75rem',
            letterSpacing: '0.06em', textTransform: 'uppercase',
            background: view === 'history' ? 'var(--ink)' : 'transparent',
            color: view === 'history' ? 'var(--paper)' : 'var(--ink)',
            border: 'none', cursor: 'pointer',
          }}
        >
          My Reports {myReports.length > 0 ? `(${myReports.length})` : ''}
        </button>
      </div>

      {/* Map — always visible on top, interactive */}
      <div style={{ flex: '0 0 45dvh', position: 'relative' }}>
        <AidMap
          reports={myReports}
          center={mapCenter}
          zoom={mapZoom}
          height="100%"
          manualPin={position}
          onMapClick={(lat, lng) => setManual(lat, lng)}
          onPinDragEnd={(lat, lng) => setManual(lat, lng)}
          autoCenter={position?.source === 'gps'}
        />

        {/* GPS overlay info */}
        <div style={{
          position: 'absolute', bottom: 8, left: 8, zIndex: 1000,
          background: 'var(--paper)', border: 'var(--rule)',
          padding: '0.35rem 0.6rem', maxWidth: 'calc(100% - 16px)',
        }}>
          {geoLoading && (
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.625rem', opacity: 0.65 }}>
              Acquiring GPS…
            </span>
          )}
          {position && !geoLoading && (
            <code style={{ fontFamily: 'var(--font-mono)', fontSize: '0.625rem' }}>
              {position.lat.toFixed(5)}, {position.lng.toFixed(5)}
              {position.accuracy != null ? ` ±${Math.round(position.accuracy)} m` : ''}
              {position.source === 'gps' ? ' (GPS)' : ' (pin)'}
            </code>
          )}
          {geoError && !geoLoading && !position && (
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.625rem', opacity: 0.65 }}>
              Tap map to place pin
            </span>
          )}
        </div>
      </div>

      {/* Bottom panel — scrollable */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '1rem 1.25rem' }}>
        {view === 'form' ? (
          <>
            {/* GPS warnings / errors */}
            {geoWarning && (
              <p style={{
                fontFamily: 'var(--font-mono)', fontSize: '0.75rem',
                borderLeft: '3px solid var(--ink)', paddingLeft: '0.75rem',
                marginBottom: '1rem', lineHeight: 1.45,
              }}>
                {geoWarning}
              </p>
            )}
            {geoError && (
              <div style={{ marginBottom: '1rem' }}>
                <p style={{ fontSize: '0.8125rem', lineHeight: 1.5 }}>{geoError}</p>
                {!denied && (
                  <button
                    type="button"
                    className="btn-text"
                    onClick={requestGeo}
                    style={{ fontSize: '0.8125rem', marginTop: '0.4rem' }}
                  >
                    Use my location
                  </button>
                )}
              </div>
            )}
            {!position && !geoError && !geoLoading && (
              <button
                type="button"
                className="btn-text"
                onClick={requestGeo}
                style={{ fontSize: '0.8125rem', marginBottom: '1rem', display: 'block' }}
              >
                Use my location
              </button>
            )}

            {/* 4 large need type toggles in 2×2 grid */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0, marginBottom: '1rem' }}>
              {NEED_TYPES.map(nt => (
                <NeedToggle
                  key={nt}
                  needType={nt}
                  selected={selectedNeeds.includes(nt)}
                  onToggle={toggleNeed}
                />
              ))}
            </div>

            {selectedNeeds.length > 0 && (
              <p style={{
                fontFamily: 'var(--font-mono)', fontSize: '0.6875rem',
                opacity: 0.55, marginBottom: '0.75rem', letterSpacing: '0.06em',
              }}>
                SELECTED: {selectedNeeds.map(n => NEED_LABELS[n]).join(' · ')}
              </p>
            )}

            {/* Send button */}
            <button
              id="citizen-send"
              type="button"
              className="btn-solid"
              disabled={!canSend || selectedNeeds.length === 0}
              onClick={handleSend}
              style={{ width: '100%', fontSize: '0.875rem' }}
            >
              {submitting
                ? 'Sending…'
                : !isOnline
                  ? 'Save (offline)'
                  : selectedNeeds.length === 0
                    ? 'Select at least one need'
                    : 'Send report'}
            </button>
          </>
        ) : (
          <MyReportsList reports={myReports} queue={queue} />
        )}
      </div>
    </div>
  )
}