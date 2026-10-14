import React, { useState, useEffect } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { useAuth } from "../context/AuthContext"
import { useReports } from "../hooks/useReports"
import { useGeolocation } from "../hooks/useGeolocation"
import { useOffline } from "../context/OfflineContext"
import AidMap from "../components/AidMap"
import { StatusLabel, NeedTypeBadge } from "../components/StatusIndicators"
import Toast from "../components/Toast"

const NEED_TYPES = ["Medical", "Water", "Shelter", "Food"]

const reportSchema = z.object({
  needType:    z.enum(["Medical", "Water", "Shelter", "Food"], { message: "Select a need type" }),
  description: z.string().min(20, "Please describe the situation in at least 20 characters").max(500),
})

function ReportForm({ onSuccess }) {
  const { user } = useAuth()
  const { submitReport } = useReports(user.id)
  const { position, loading: geoLoading, error: geoError, request: requestGeo, setManual } = useGeolocation()
  const { isOnline } = useOffline()

  const [manualPin, setManualPin] = useState(null)
  const [toast, setToast]         = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [selectedNeedType, setSelectedNeedType] = useState(null)

  const { register, handleSubmit, setValue, formState: { errors }, reset } = useForm({
    resolver: zodResolver(reportSchema),
  })

  const handleMapClick = (lat, lng) => {
    setManualPin({ lat, lng })
    setManual(lat, lng)
  }

  const onSubmit = async (data) => {
    const loc = position || manualPin
    if (!loc) {
      setToast("Set your location via GPS or map pin before submitting.")
      return
    }
    setSubmitting(true)
    try {
      const result = await submitReport({
        needType: data.needType,
        description: data.description,
        lat: loc.lat,
        lng: loc.lng,
        accuracy: loc.accuracy,
      })
      reset()
      setSelectedNeedType(null)
      setManualPin(null)
      setToast(result.queued ? "Report queued — will send when online." : "Report submitted.")
      onSuccess?.()
    } catch {
      setToast("Submission failed. Check your connection.")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      {toast && <Toast message={toast} onDone={() => setToast(null)} />}
      <form onSubmit={handleSubmit(onSubmit)} noValidate>
        <div style={{ marginBottom: "2rem" }}>
          <label className="field-label">Need type</label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0" }}>
            {NEED_TYPES.map((nt) => (
              <button
                key={nt}
                type="button"
                id={"need-" + nt.toLowerCase()}
                onClick={() => { setSelectedNeedType(nt); setValue("needType", nt, { shouldValidate: true }) }}
                style={{
                  background: selectedNeedType === nt ? "var(--ink)" : "transparent",
                  color: selectedNeedType === nt ? "var(--paper)" : "var(--ink)",
                  border: "1px solid var(--ink)",
                  borderRadius: 0,
                  padding: "0.65rem 1rem",
                  fontFamily: "var(--font-mono)",
                  fontSize: "0.8125rem",
                  letterSpacing: "0.04em",
                  cursor: "pointer",
                  textAlign: "left",
                  transition: "background 0.1s",
                  marginTop: "-1px", marginLeft: "-1px",
                }}
              >
                {nt.toUpperCase()}
              </button>
            ))}
          </div>
          {errors.needType && <p className="field-error">{errors.needType.message}</p>}
        </div>

        <div style={{ marginBottom: "2rem" }}>
          <label className="field-label" htmlFor="report-desc">Description</label>
          <textarea
            id="report-desc"
            className={"input-underline" + (errors.description ? " error" : "")}
            placeholder="Describe the situation clearly — who is affected, how many people, urgency level."
            rows={4}
            {...register("description")}
          />
          {errors.description && <p className="field-error">{errors.description.message}</p>}
        </div>

        <div style={{ marginBottom: "2rem" }}>
          <label className="field-label">Location</label>
          <div style={{ display: "flex", alignItems: "center", gap: "1rem", marginBottom: "0.75rem" }}>
            <button type="button" className="btn-solid" onClick={requestGeo} disabled={geoLoading}
              style={{ fontSize: "0.75rem", padding: "0.5rem 1rem" }}>
              {geoLoading ? "Locating..." : "Use GPS"}
            </button>
            {position && (
              <code className="mono" style={{ fontSize: "0.75rem", opacity: 0.7 }}>
                {position.lat.toFixed(5)}, {position.lng.toFixed(5)}
                {position.accuracy != null && " ±" + position.accuracy + "m"}
              </code>
            )}
          </div>
          {geoError && <p className="field-error" style={{ marginBottom: "0.5rem" }}>{geoError}</p>}
          <p style={{ fontSize: "0.75rem", opacity: 0.5, marginBottom: "0.75rem" }}>
            Or click the map to place a pin manually.
          </p>
          <div style={{ height: 220, border: "var(--rule)" }}>
            <AidMap
              reports={[]}
              center={position ? [position.lat, position.lng] : [6.4550, 3.3841]}
              zoom={position ? 15 : 13}
              onMapClick={handleMapClick}
              manualPin={manualPin || position}
              height="220px"
            />
          </div>
          {manualPin && !position && (
            <code className="mono" style={{ fontSize: "0.75rem", opacity: 0.7, marginTop: "0.4rem", display: "block" }}>
              PIN: {manualPin.lat.toFixed(5)}, {manualPin.lng.toFixed(5)} — manual
            </code>
          )}
        </div>

        <button
          id="report-submit"
          type="submit"
          className="btn-solid"
          disabled={submitting}
          style={{ width: "100%" }}
        >
          {!isOnline ? "Queue report (offline)" : submitting ? "Submitting..." : "Submit emergency report"}
        </button>
      </form>
    </>
  )
}

function MyReports({ reports, queue }) {
  const allReports = [
    ...queue.map(q => ({ ...q.payload, id: "q-" + q.id, status: "queued", createdAt: q.queuedAt })),
    ...reports,
  ]

  if (allReports.length === 0) {
    return <p style={{ opacity: 0.45, fontSize: "0.875rem", paddingTop: "1rem" }}>No reports yet.</p>
  }

  return (
    <ul className="ruled-list">
      {allReports.map((r) => (
        <li key={r.id} style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", justifyContent: "space-between" }}>
            <NeedTypeBadge needType={r.needType} />
            <StatusLabel status={r.status} />
          </div>
          <p style={{ fontSize: "0.875rem", opacity: 0.75, lineHeight: 1.5 }}>
            {r.description?.slice(0, 100)}{r.description?.length > 100 ? "…" : ""}
          </p>
          <code className="mono" style={{ fontSize: "0.65rem", opacity: 0.4 }}>
            {r.lat != null ? Number(r.lat).toFixed(5) + ", " + Number(r.lng).toFixed(5) : "Location pending"}
            {r.accuracy != null ? " ±" + r.accuracy + "m" : ""}
            {" · "}
            {new Date(r.createdAt).toLocaleString("en-GB", { day:"numeric", month:"short", hour:"2-digit", minute:"2-digit" })}
          </code>
        </li>
      ))}
    </ul>
  )
}

export default function CitizenPage() {
  const { user } = useAuth()
  const { reports, myReports, pendingQueue } = useReports(user.id)
  const [view, setView] = useState("report")

  return (
    <div style={{ maxWidth: 680, margin: "0 auto", padding: "clamp(1.5rem, 4vw, 3rem) 1.5rem" }}>
      <div style={{ display: "flex", marginBottom: "2.5rem", borderBottom: "var(--rule)" }}>
        {[
          { id: "report", label: "Report an emergency" },
          { id: "list",   label: "My reports" + (myReports.length > 0 ? " (" + myReports.length + ")" : "") },
        ].map(tab => (
          <button
            key={tab.id}
            id={"tab-" + tab.id}
            type="button"
            onClick={() => setView(tab.id)}
            style={{
              background: "none", border: "none",
              borderBottom: view === tab.id ? "2px solid var(--ink)" : "2px solid transparent",
              color: "var(--ink)",
              fontFamily: "var(--font-sans)",
              fontSize: "0.875rem",
              fontWeight: view === tab.id ? 500 : 300,
              padding: "0.5rem 0",
              marginRight: "2rem",
              cursor: "pointer",
              marginBottom: "-1px",
              transition: "border-color 0.15s",
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="fade-in" key={view}>
        {view === "report"
          ? <ReportForm onSuccess={() => setTimeout(() => setView("list"), 1000)} />
          : <MyReports reports={myReports} queue={pendingQueue} />
        }
      </div>
    </div>
  )
}