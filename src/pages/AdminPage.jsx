import React, { useState, useEffect } from "react"
import AidMap, { DEFAULT_TN_CENTER } from "../components/AidMap"
import { StatusLabel } from "../components/StatusIndicators"
import Toast from "../components/Toast"
import { useReports } from "../hooks/useReports"
import { useAuth } from "../context/AuthContext"
import { govApi } from "../api/endpoints"

export default function AdminPage() {
  const { user } = useAuth()
  const { reports } = useReports(user.id)
  const [clusters, setClusters] = useState([])
  const [users, setUsers]       = useState([])
  const [view, setView]         = useState("clusters")
  const [toast, setToast]       = useState(null)

  useEffect(() => {
    let cancelled = false
    govApi.clusters().then(res => {
      if (!cancelled) setClusters(Array.isArray(res.data) ? res.data : [])
    }).catch(() => {
      if (!cancelled) setClusters([])
    })

    govApi.listNgos().then(res => {
      if (!cancelled) setUsers(Array.isArray(res.data) ? res.data : [])
    }).catch(() => {
      if (!cancelled) setUsers([])
    })

    return () => { cancelled = true }
  }, [])

  const handleForceRelease = async (clId) => {
    try {
      await govApi.gaps()
      setClusters(prev => prev.map(c => c.id === clId ? { ...c, staleClaims: 0 } : c))
      setToast("Stale claims released.")
    } catch {
      setToast("Failed to release.")
    }
  }

  const handleSuspend = async (uid) => {
    try {
      await govApi.suspend(uid)
      setUsers(prev => prev.map(u => u.id === uid ? { ...u, status: "suspended" } : u))
      setToast("User suspended.")
    } catch {
      setToast("Failed to suspend.")
    }
  }

  const handleRestore = async (uid) => {
    try {
      await govApi.restore(uid)
      setUsers(prev => prev.map(u => u.id === uid ? { ...u, status: "active" } : u))
      setToast("User restored.")
    } catch {
      setToast("Failed to restore.")
    }
  }

  const tabs = [
    { id: "clusters", label: "Clusters" },
    { id: "heatmap",  label: "Coverage gaps" },
    { id: "map",      label: "Live map" },
    { id: "users",    label: "Users" },
  ]

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "calc(100dvh - 52px)" }}>
      {toast && <Toast message={toast} onDone={() => setToast(null)} />}

      <div style={{ display: "flex", borderBottom: "var(--rule)", padding: "0 1.5rem" }}>
        {tabs.map((t) => (
          <button
            key={t.id}
            id={"tab-" + t.id}
            type="button"
            className="btn-text"
            onClick={() => setView(t.id)}
            style={{
              padding: "0.875rem 1rem",
              borderBottom: view === t.id ? "2px solid var(--ink)" : "2px solid transparent",
              fontWeight: view === t.id ? 500 : 400,
              fontSize: "0.875rem",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "1.5rem" }}>
        {view === "clusters" && (
          <>
            <h3 style={{ marginBottom: "1.25rem" }}>Duplicate request clusters</h3>
            <ClustersTable clusters={clusters} onForceRelease={handleForceRelease} />
          </>
        )}

        {view === "heatmap" && (
          <>
            <h3 style={{ marginBottom: "1.25rem" }}>Coverage gap heatmap</h3>
            <CoverageHeatmap clusters={clusters} />
            <div style={{ marginTop: "2rem", borderTop: "var(--rule)", paddingTop: "1rem" }}>
              <p style={{ fontFamily: "var(--font-mono)", fontSize: "0.6875rem", opacity: 0.45, letterSpacing: "0.06em" }}>
                CELL SIZE = REPORT DENSITY · HATCH DENSITY = URGENCY · NO COLOR ENCODING
              </p>
            </div>
          </>
        )}

        {view === "map" && (
          <div style={{ height: "calc(100dvh - 240px)", border: "var(--rule)" }}>
            <AidMap reports={reports} center={DEFAULT_TN_CENTER} zoom={7} height="100%" readOnly />
          </div>
        )}

        {view === "users" && (
          <>
            <h3 style={{ marginBottom: "1.25rem" }}>User management</h3>
            <UsersTable users={users} onSuspend={handleSuspend} onRestore={handleRestore} />
          </>
        )}
      </div>
    </div>
  )
}

function CoverageHeatmap({ clusters }) {
  if (clusters.length === 0) {
    return <p style={{ opacity: 0.45, fontSize: "0.875rem" }}>No coverage gaps detected.</p>
  }

  const max = Math.max(...clusters.map(c => c.count), 1)
  return (
    <div>
      <p style={{ fontFamily: "var(--font-mono)", fontSize: "0.6875rem", letterSpacing: "0.08em", opacity: 0.45, marginBottom: "0.75rem" }}>
        COVERAGE GAP INTENSITY (size = report density)
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem" }}>
        {clusters.map((c) => {
          const intensity = c.count / max
          const cellSize  = 48 + intensity * 64
          return (
            <div
              key={c.id}
              style={{
                width: cellSize, height: cellSize,
                border: "var(--rule)",
                position: "relative",
                overflow: "hidden",
                flexShrink: 0,
              }}
              title={c.count + " reports · " + (c.needTypes || []).join(", ")}
            >
              <div style={{
                position: "absolute", inset: 0,
                background: "repeating-linear-gradient(45deg, var(--ink) 0, var(--ink) 1px, transparent 0, transparent " + Math.max(2, 10 - intensity * 6) + "px)",
                opacity: 0.15 + intensity * 0.65,
              }} />
              <div style={{ position: "relative", padding: "0.3rem", zIndex: 1 }}>
                <p style={{ fontFamily: "var(--font-mono)", fontSize: "0.6rem", lineHeight: 1.3, opacity: 0.8 }}>
                  {c.count}
                  <br />
                  {c.needTypes?.[0]?.slice(0,3).toUpperCase()}
                  {c.staleClaims > 0 && (
                    <span style={{ display: "block", fontSize: "0.55rem", opacity: 0.7 }}>
                      {c.staleClaims} stale
                    </span>
                  )}
                </p>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function ClustersTable({ clusters, onForceRelease }) {
  const [releasing, setReleasing] = useState({})

  const handleRelease = async (clId) => {
    setReleasing(prev => ({ ...prev, [clId]: true }))
    await new Promise(r => setTimeout(r, 600))
    setReleasing(prev => ({ ...prev, [clId]: false }))
    onForceRelease(clId)
  }

  if (clusters.length === 0) {
    return (
      <div style={{ padding: "2rem 0", opacity: 0.5 }}>
        <p style={{ fontSize: "0.875rem", margin: 0 }}>No report clusters found.</p>
      </div>
    )
  }

  return (
    <div style={{ overflowX: "auto" }}>
      <table className="data-table">
        <thead>
          <tr>
            <th>Cluster ID</th>
            <th>Reports</th>
            <th>Need Types</th>
            <th>Radius</th>
            <th>Stale Claims</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {clusters.map(c => (
            <tr key={c.id}>
              <td><code className="mono" style={{ fontSize: "0.75rem" }}>{c.id}</code></td>
              <td style={{ fontFamily: "var(--font-serif)", fontSize: "1.1rem" }}>{c.count}</td>
              <td>
                <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
                  {(c.needTypes || []).map(t => (
                    <span key={t} style={{ fontFamily: "var(--font-mono)", fontSize: "0.65rem", letterSpacing: "0.06em" }}>
                      {t.toUpperCase()}
                    </span>
                  ))}
                </div>
              </td>
              <td><code className="mono" style={{ fontSize: "0.75rem" }}>{c.radius}m</code></td>
              <td style={{ fontFamily: "var(--font-serif)", fontSize: "1.1rem", opacity: c.staleClaims > 0 ? 1 : 0.35 }}>
                {c.staleClaims}
              </td>
              <td>
                {c.staleClaims > 0 ? (
                  <button
                    id={"force-release-" + c.id}
                    type="button"
                    className="btn-text"
                    onClick={() => handleRelease(c.id)}
                    disabled={releasing[c.id]}
                    style={{ fontSize: "0.8125rem" }}
                  >
                    {releasing[c.id] ? "Releasing…" : "Force release"}
                  </button>
                ) : (
                  <span style={{ opacity: 0.3, fontSize: "0.8125rem" }}>—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function UsersTable({ users, onSuspend, onRestore }) {
  if (users.length === 0) {
    return (
      <div style={{ padding: "2rem 0", opacity: 0.5 }}>
        <p style={{ fontSize: "0.875rem", margin: 0 }}>No users found.</p>
      </div>
    )
  }

  return (
    <div style={{ overflowX: "auto" }}>
      <table className="data-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Role</th>
            <th>Reports</th>
            <th>Status</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {users.map(u => (
            <tr key={u.id} style={{ opacity: u.status === "suspended" ? 0.5 : 1 }}>
              <td style={{ fontSize: "0.875rem" }}>{u.name}</td>
              <td><code className="mono" style={{ fontSize: "0.7rem" }}>{u.email}</code></td>
              <td>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.65rem", letterSpacing: "0.06em" }}>
                  {u.role?.toUpperCase()}
                </span>
              </td>
              <td style={{ fontFamily: "var(--font-serif)", fontSize: "1.1rem" }}>{u.reports || 0}</td>
              <td>
                <StatusLabel status={u.status === "suspended" ? "claimed" : "resolved"} />
              </td>
              <td>
                {u.status === "active" ? (
                  <button
                    id={"suspend-" + u.id}
                    type="button"
                    className="btn-text"
                    onClick={() => onSuspend(u.id)}
                    style={{ fontSize: "0.8125rem" }}
                  >
                    Suspend
                  </button>
                ) : (
                  <button
                    id={"restore-" + u.id}
                    type="button"
                    className="btn-text"
                    onClick={() => onRestore(u.id)}
                    style={{ fontSize: "0.8125rem" }}
                  >
                    Restore
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}