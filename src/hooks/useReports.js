import { useState, useCallback, useEffect, useRef } from 'react'
import { useAuth } from '../context/AuthContext'
import { useOffline } from '../context/OfflineContext'
import { useSocket } from '../context/SocketContext'
import { reportsApi } from '../api/endpoints'
import { normalizeReport } from '../utils/domain'

const CACHE_PREFIX = 'aidpulse_reports_'

function cacheGet(key) {
  try { return JSON.parse(sessionStorage.getItem(CACHE_PREFIX + key) || 'null') }
  catch { return null }
}
function cacheSet(key, data) {
  try { sessionStorage.setItem(CACHE_PREFIX + key, JSON.stringify(data)) }
  catch {}
}
function cacheClear() {
  try {
    Object.keys(sessionStorage)
      .filter(k => k.startsWith(CACHE_PREFIX))
      .forEach(k => sessionStorage.removeItem(k))
  } catch {}
}

// Exponential backoff retry
async function withRetry(fn, maxTries = 3, delayMs = 1000) {
  let last
  for (let i = 0; i < maxTries; i++) {
    try { return await fn() }
    catch (e) {
      last = e
      if (i < maxTries - 1) await new Promise(r => setTimeout(r, delayMs * 2 ** i))
    }
  }
  throw last
}

export function useReports(role = 'citizen') {
  const { user }                      = useAuth()
  const { isOnline, enqueue, dequeue, queue } = useOffline()
  const { liveUpdates }               = useSocket()

  const [reports,  setReports]  = useState(() => cacheGet(role) || [])
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState(null)
  const fetchRef               = useRef(false)

  // Merge live socket updates into the report list
  useEffect(() => {
    if (!Object.keys(liveUpdates).length) return
    setReports(prev => {
      let changed = false
      const next = prev.map(r => {
        const u = liveUpdates[r.id]
        if (u) {
          const nu = normalizeReport(u)
          if (nu && JSON.stringify(nu) !== JSON.stringify(r)) { changed = true; return { ...r, ...nu } }
        }
        return r
      })
      // add brand-new reports not yet in list
      Object.values(liveUpdates).forEach(u => {
        const nu = normalizeReport(u)
        if (nu && !next.find(r => r.id === nu.id)) { next.unshift(nu); changed = true }
      })
      if (changed) cacheSet(role, next)
      return changed ? next : prev
    })
  }, [liveUpdates, role])

  // Flush reports cache on logout
  useEffect(() => {
    const h = () => { setReports([]); cacheClear() }
    window.addEventListener('aidpulse:auth-expired', h)
    return () => window.removeEventListener('aidpulse:auth-expired', h)
  }, [])

  const fetch = useCallback(async () => {
    if (!user) { setReports([]); return }
    setLoading(true)
    setError(null)
    try {
      let res
      if (role === 'citizen') res = await reportsApi.mine()
      else res = await reportsApi.all()
      const raw = Array.isArray(res.data) ? res.data : []
      const data = raw.map(normalizeReport).filter(Boolean)
      setReports(data)
      cacheSet(role, data)
    } catch (e) {
      setError(e)
      const cached = cacheGet(role)
      if (cached) setReports(cached)
    } finally {
      setLoading(false)
    }
  }, [user, role])

  useEffect(() => {
    if (fetchRef.current) return
    fetchRef.current = true
    fetch()
  }, [fetch])

  // Per-report clientId tracking: { [clientId]: localReportId }
  const submit = useCallback(async ({ needs, lat, lng, accuracyMeters }) => {
    const clientId = crypto.randomUUID()
    const payload  = { needs, lat, lng, accuracyMeters: accuracyMeters ?? undefined, clientId }

    // Optimistic local record
    const optimistic = {
      id: `local-${clientId}`,
      needs: needs.map(nt => ({ needType: nt, status: 'pending', claimedBy: null })),
      needType: needs[0],
      lat, lng, accuracyMeters: accuracyMeters ?? null,
      status: 'pending',
      reporterCount: 1,
      duplicateCount: 0,
      flags: [],
      createdAt: new Date().toISOString(),
      reportedBy: user?.id,
      clientId,
    }

    if (!isOnline) {
      enqueue({ type: 'REPORT', payload, clientId })
      setReports(prev => {
        const next = [{ ...optimistic, _queued: true }, ...prev]
        cacheSet(role, next)
        return next
      })
      return { queued: true, report: optimistic }
    }

    setReports(prev => [optimistic, ...prev])
    try {
      const { data } = await reportsApi.create(payload)
      const saved = normalizeReport(data)
      setReports(prev => {
        const next = prev.map(r => r.id === optimistic.id ? saved : r)
        cacheSet(role, next)
        return next
      })
      return { success: true, report: saved }
    } catch (err) {
      setReports(prev => prev.filter(r => r.id !== optimistic.id))
      throw err
    }
  }, [isOnline, enqueue, user, role])

  // Apply a server-returned report (claim/release/status) to local state + cache.
  const applyServerReport = useCallback((reportId, raw) => {
    const nu = normalizeReport(raw)
    if (!nu) return
    setReports(prev => {
      const next = prev.map(r => r.id === reportId ? { ...r, ...nu } : r)
      cacheSet(role, next)
      return next
    })
  }, [role])

  // Claim a specific need type in a report (NOT optimistic)
  const claimNeed = useCallback(async (reportId, needType) => {
    try {
      const res = await reportsApi.claimNeed(reportId, needType)
      applyServerReport(reportId, res.data)
      return { success: true }
    } catch (err) {
      if (err.response?.status === 409) return { alreadyClaimed: true }
      throw err
    }
  }, [applyServerReport])

  const releaseNeed = useCallback(async (reportId, needType) => {
    const res = await reportsApi.releaseNeed(reportId, needType)
    applyServerReport(reportId, res.data)
    return { success: true }
  }, [applyServerReport])

  const updateNeedStatus = useCallback(async (reportId, needType, status) => {
    const res = await reportsApi.needStatus(reportId, needType, status)
    applyServerReport(reportId, res.data)
    return { success: true }
  }, [applyServerReport])

  // Retry queued reports on reconnect
  useEffect(() => {
    const handler = async (e) => {
      const items = e.detail || []
      for (const item of items) {
        if (item.type !== 'REPORT') continue
        try {
          await withRetry(() => reportsApi.create(item.payload))
          dequeue(item.id)
        } catch {}
      }
      fetch()
    }
    window.addEventListener('aidpulse:retry-queue', handler)
    return () => window.removeEventListener('aidpulse:retry-queue', handler)
  }, [dequeue, fetch])

  // /reports/mine is already scoped to the caller (and hides reportedBy for
  // citizens), so the fetched list *is* "my reports".
  const myReports = reports

  return {
    reports,
    myReports,
    loading,
    error,
    refresh: fetch,
    submit,
    claimNeed,
    releaseNeed,
    updateNeedStatus,
    pendingQueue: queue,
  }
}
