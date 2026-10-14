import React, { useState, useCallback, useEffect } from "react"
import { useAuth } from "../context/AuthContext"
import { useReports } from "../hooks/useReports"
import AidMap from "../components/AidMap"
import { StatusLabel, NeedTypeBadge } from "../components/StatusIndicators"
import Toast from "../components/Toast"

const NEED_TYPE_ORDER = ["Medical", "Water", "Shelter", "Food"]

function distanceLabel(d) {
  if (d == null) return "—"
  return d < 1 ? Math.round(d * 1000) + " m" : d.toFixed(1) + " km"
}

export default function NGOPage() {
  const { user } = useAuth()
  const { reports, claimReport, updateReportFromSocket } = useReports(user.id)
  const [selectedId, setSelectedId]   = useState(null)
  const [claimedRows, setClaimedRows] = useState({})
  const [toast, setToast]             = useState(null)

  // Only show pending + claimed, sorted by distance
  const pending = [...reports]
    .filter(r => r.status === "pending" || r.status === "claimed")
    .sort((a, b) => (a.distance ?? 999) - (b.distance ?? 999))

  const handleClaim = useCallback(async (reportId) => {
    try {
      const result = await claimReport(reportId)
      if (result.alreadyClaimed) {
        setClaimedRows(prev => ({ ...prev, [reportId]: "other" }))
        setToast("Already claimed by another responder.")
      } else {
        setClaimedRows(prev => ({ ...prev, [reportId]: "mine" }))
        setToast("Claim recorded.")
      }
    } catch {
      setToast("Could not process claim. Check your connection.")
    }
  }, [claimReport])

  // Sync socket updates with local claim state
  useEffect(() => {
    // updateReportFromSocket is called by SocketContext
  }, [updateReportFromSocket])

  return (
    <div className="map-split">
      {toast && <Toast message={toast} onDone={() => setToast(null)} />}

      <div style={{ position: "relative", borderRight: "var(--rule)" }}>
        <AidMap
          reports={reports}
          height="100%"
          selectedId={selectedId}
          onReportClick={(r) => setSelectedId(r.id)}
        />
      </div>

      <div style={{ overflowY: "auto", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "1rem 1.5rem", borderBottom: "var(--rule)", position: "sticky", top: 0, background: "var(--paper)", zIndex: 10 }}>
          <p style={{ fontFamily: "var(--font-mono)", fontSize: "0.6875rem", letterSpacing: "0.08em", opacity: 0.55 }}>
            PENDING REQUESTS — {pending.length} NEARBY
          </p>
        </div>

        {pending.length === 0 && (
          <div style={{ padding: "2rem 1.5rem", opacity: 0.45 }}>
            <p style={{ fontSize: "0.875rem" }}>No pending requests in your area.</p>
          </div>
        )}

        <ul className="ruled-list" style={{ margin: 0, padding: "0 1.5rem" }}>
          {pending.map(r => {
            const claimState = claimedRows[r.id]
            const isClaimed  = claimState === "other" || r.status === "claimed"
            const isMine     = claimState === "mine"

            return (
              <li
                key={r.id}
                id={"request-" + r.id}
                className={isClaimed && !isMine ? "row-claimed" : ""}
                style={{
                  cursor: "pointer",
                  background: selectedId === r.id
                    ? "color-mix(in srgb, var(--ink) 5%, transparent)" : "transparent",
                  transition: "background 0.15s",
                }}
                onClick={() => setSelectedId(r.id)}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "0.5rem" }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem", flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                      <NeedTypeBadge needType={r.needType} />
                      <code className="mono" style={{ fontSize: "0.7rem", opacity: 0.5 }}>
                        {distanceLabel(r.distance)}
                      </code>
                      <StatusLabel status={r.status} />
                    </div>
                    <p style={{ fontSize: "0.8125rem", opacity: 0.75, lineHeight: 1.5 }}>
                      {r.description?.slice(0, 120)}{r.description?.length > 120 ? "…" : ""}
                    </p>
                  </div>

                  <div style={{ flexShrink: 0 }}>
                    {isClaimed && !isMine ? (
                      <span style={{
                        fontFamily: "var(--font-mono)", fontSize: "0.7rem", opacity: 0.5,
                        textDecoration: "line-through",
                      }}>
                        Already claimed
                      </span>
                    ) : isMine ? (
                      <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.7rem", opacity: 0.6 }}>
                        Claimed ✓
                      </span>
                    ) : (
                      <button
                        id={"claim-" + r.id}
                        type="button"
                        className="btn-text"
                        onClick={(e) => { e.stopPropagation(); handleClaim(r.id) }}
                        style={{ fontSize: "0.8125rem" }}
                      >
                        Claim
                      </button>
                    )}
                  </div>
                </div>

                <code className="mono" style={{ fontSize: "0.625rem", opacity: 0.35, marginTop: "0.3rem", display: "block" }}>
                  {Number(r.lat).toFixed(5)}, {Number(r.lng).toFixed(5)}
                  {r.accuracy != null ? " ±" + r.accuracy + "m" : ""}
                </code>
              </li>
            )
          })}
        </ul>

        <div style={{ marginTop: "auto", padding: "1rem 1.5rem", borderTop: "var(--rule)" }}>
          <p style={{ fontFamily: "var(--font-mono)", fontSize: "0.6rem", letterSpacing: "0.08em", opacity: 0.35 }}>
            ○ MEDICAL · □ WATER · △ SHELTER · ◇ FOOD · FILLED = CLAIMED
          </p>
        </div>
      </div>
    </div>
  )
}