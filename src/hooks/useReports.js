import { useState, useCallback, useEffect, useRef } from 'react'
import { useAuth } from '../context/AuthContext'
import { useOffline } from '../context/OfflineContext'
import { useSocket } from '../context/SocketContext'
import { reportsApi } from '../api/endpoints'

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
        if (u && JSON.stringify(u) !== JSON.stringify(r)) { changed = true; return { ...r, ...u } }
        return r
      })
      // add brand-new reports not yet in list
      Object.values(liveUpdates).forEach(u => {
        if (!next.find(r => r.id === u.id)) { next.unshift(u); changed = true }
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
      const data = Array.isArray(res.data) ? res.data : []
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
  const submit = useCallback(async ({ needTypes, lat, lng, accuracyMeters, locationSource }) => {
    const clientId = crypto.randomUUID()
    const payload  = { needTypes, lat, lng, accuracyMeters, locationSource, clientId }

    // Optimistic local record
    const optimistic = {
      id: `local-${clientId}`,
      needTypes,
      lat, lng, accuracyMeters,
      status: 'pending',
      // Each need has its own status
      needs: needTypes.map(nt => ({ needType: nt, status: 'sent', claimedBy: null })),
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
      setReports(prev => {
        const next = prev.map(r => r.id === optimistic.id ? data : r)
        cacheSet(role, next)
        return next
      })
      return { success: true, report: data }
    } catch (err) {
      setReports(prev => prev.filter(r => r.id !== optimistic.id))
      throw err
    }
  }, [isOnline, enqueue, user, role])

  // Claim a specific need type in a report (NOT optimistic)
  const claimNeed = useCallback(async (reportId, needType) => {
    try {
      // Try per-need endpoint, fall back to legacy
      let res
      try {
        res = await reportsApi.claimNeed(reportId, needType)
      } catch {
        res = await reportsApi.claim(reportId)
      }
      setReports(prev => {
        const next = prev.map(r => {
          if (r.id !== reportId) return r
          const needs = (r.needs || []).map(n =>
            n.needType === needType
              ? { ...n, status: 'claimed', claimedBy: user?.id }
              : n
          )
          return { ...r, needs, status: res.data?.status || r.status }
        })
        cacheSet(role, next)
        return next
      })
      return { success: true }
    } catch (err) {
      if (err.response?.status === 409) return { alreadyClaimed: true }
      throw err
    }
  }, [user, role])

  const releaseNeed = useCallback(async (reportId, needType) => {
    try {
      try { await reportsApi.releaseNeed(reportId, needType) }
      catch { await reportsApi.release(reportId) }
      setReports(prev => {
        const next = prev.map(r => {
          if (r.id !== reportId) return r
          const needs = (r.needs || []).map(n =>
            n.needType === needType ? { ...n, status: 'pending', claimedBy: null } : n
          )
          return { ...r, needs }
        })
        cacheSet(role, next)
        return next
      })
      return { success: true }
    } catch (err) {
      throw err
    }
  }, [role])

  const updateNeedStatus = useCallback(async (reportId, needType, status) => {
    try {
      try { await reportsApi.needStatus(reportId, needType, status) }
      catch { await reportsApi.status(reportId, status) }
      setReports(prev => {
        const next = prev.map(r => {
          if (r.id !== reportId) return r
          const needs = (r.needs || []).map(n =>
            n.needType === needType ? { ...n, status } : n
          )
          return { ...r, needs, status: needs.every(n => n.status === 'resolved') ? 'resolved' : r.status }
        })
        cacheSet(role, next)
        return next
      })
      return { success: true }
    } catch (err) { throw err }
  }, [role])

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

  const myReports = role === 'citizen'
    ? reports.filter(r => r.reportedBy === user?.id)
    : reports

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
