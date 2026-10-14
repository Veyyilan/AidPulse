import React, { useState, useMemo, useEffect } from "react"
import { useReports } from "../hooks/useReports"
import { useAuth } from "../context/AuthContext"
import AidMap from "../components/AidMap"
import { StatusLabel, NeedTypeBadge } from "../components/StatusIndicators"
import { statsApi } from "../api/endpoints"

const NEED_TYPES = ["Medical", "Water", "Shelter", "Food"]
const STATUSES   = ["pending", "claimed", "resolved"]

function StatsStrip({ stats }) {
  return (
    <div className="stats-strip" style={{ flexWrap: "wrap" }}>
      {[
        { label: "Total Reports", value: stats.totalReports },
        { label: "Pending",       value: stats.pending },
        { label: "Claimed",       value: stats.claimed },
        { label: "Resolved",      value: stats.resolved },
        { label: "Avg. Response", value: stats.avgResponseMin + " min" },
        { label: "Coverage Gaps", value: stats.coverageGaps },
      ].map(({ label, value }) => (
        <div key={label} className="stat">
          <p style={{
            fontFamily: "var(--font-mono)", fontSize: "0.625rem",
            letterSpacing: "0.1em", textTransform: "uppercase", opacity: 0.45,
            marginBottom: "0.25rem",
          }}>
            {label}
          </p>
          <p style={{ fontFamily: "var(--font-serif)", fontSize: "1.6rem", fontWeight: 400, lineHeight: 1 }}>
            {value}
          </p>
        </div>
      ))}
    </div>
  )
}

export default function GovernmentPage() {
  const { user } = useAuth()
  const { reports } = useReports(user.id)
  const [stats, setStats] = useState(null)
  const [statusFilter, setStatusFilter] = useState("")
  const [needTypeFilter, setNeedTypeFilter] = useState("")

  useEffect(() => {
    let cancelled = false
    statsApi.overview().then(res => {
      if (!cancelled) setStats(res.data)
    }).catch(console.error)
    return () => { cancelled = true }
  }, [])

  const filtered = useMemo(() => {
    return reports.filter(r => {
      if (statusFilter   && r.status   !== statusFilter)   return false
      if (needTypeFilter && r.needType !== needTypeFilter) return false
      return true
    })
  }, [reports, statusFilter, needTypeFilter])

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "calc(100dvh - 52px)" }}>
      {stats ? <StatsStrip stats={stats} /> : <div className="stats-strip" style={{opacity: 0.3}}>Loading…</div>}

      <div className="filter-bar">
        <div>
          <label className="field-label" htmlFor="gov-status">Status</label>
          <select id="gov-status" className="select-underline"
            style={{ minWidth: 140 }}
            value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="">All statuses</option>
            {STATUSES.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
          </select>
        </div>
        <div>
          <label className="field-label" htmlFor="gov-needtype">Need type</label>
          <select id="gov-needtype" className="select-underline"
            style={{ minWidth: 140 }}
            value={needTypeFilter} onChange={e => setNeedTypeFilter(e.target.value)}>
            <option value="">All types</option>
            {NEED_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <span style={{ fontSize: "0.8125rem", opacity: 0.45, alignSelf: "flex-end", paddingBottom: "0.5rem" }}>
          {filtered.length} report{filtered.length !== 1 ? "s" : ""}
        </span>
      </div>

      <div style={{ flex: 1, position: "relative" }}>
        <AidMap
          reports={filtered}
          height="100%"
          readOnly
        />
      </div>
    </div>
  )
}