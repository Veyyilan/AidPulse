import { useState, useCallback, useEffect } from 'react'
import { useOffline } from '../context/OfflineContext'
import { reportsApi } from '../api/endpoints'

export function useReports(userId) {
  const { isOnline, enqueue, dequeue, queue } = useOffline()
  const [reports, setReports] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError]   = useState(null)

  // Fetch initial reports
  useEffect(() => {
    if (!userId) return
    let cancelled = false
    const load = async () => {
      try {
        setLoading(true)
        const { data } = await reportsApi.mine()
        if (!cancelled) setReports(data)
      } catch (e) {
        if (!cancelled) setError(e)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [userId])

  const myReports = reports.filter(r => r.reportedBy === userId)

  const submitReport = useCallback(async (data) => {
    // Generate clientId for idempotency (shared between optimistic + queue)
    const clientId = crypto.randomUUID()
    const payload = { ...data, clientId }

    const optimistic = {
      ...payload,
      id: `local-${Date.now()}`,
      status: 'pending',
      createdAt: new Date().toISOString(),
      reportedBy: userId,
      claimedBy: null,
    }

    if (!isOnline) {
      enqueue({ type: 'CREATE_REPORT', payload, clientId })
      setReports(prev => [{ ...optimistic, status: 'queued' }, ...prev])
      return { queued: true }
    }

    setReports(prev => [optimistic, ...prev])
    try {
      const { data } = await reportsApi.create(payload)
      setReports(prev => prev.map(r => r.id === optimistic.id ? data : r))
      return { success: true }
    } catch (err) {
      setReports(prev => prev.filter(r => r.id !== optimistic.id))
      throw err
    }
  }, [isOnline, enqueue, userId])

  // Claim is NOT optimistic - show loading state, update only on server response
  const claimReport = useCallback(async (reportId) => {
    try {
      const { data } = await reportsApi.claim(reportId)
      setReports(prev => prev.map(r =>
        r.id === reportId ? { ...r, status: 'claimed', claimedBy: userId } : r
      ))
      return { success: true }
    } catch (err) {
      if (err.response?.status === 409) return { alreadyClaimed: true }
      throw err
    }
  }, [userId])

  const releaseReport = useCallback(async (reportId) => {
    try {
      const { data } = await reportsApi.release(reportId)
      setReports(prev => prev.map(r =>
        r.id === reportId ? { ...r, status: 'pending', claimedBy: null } : r
      ))
      return { success: true }
    } catch (err) {
      if (err.response?.status === 409) return { notClaimed: true }
      throw err
    }
  }, [])

  const updateStatus = useCallback(async (reportId, status) => {
    try {
      const { data } = await reportsApi.status(reportId, status)
      setReports(prev => prev.map(r => r.id === reportId ? data : r))
      return { success: true }
    } catch (err) {
      throw err
    }
  }, [])

  const updateReportFromSocket = useCallback((updated) => {
    setReports(prev =>
      prev.some(r => r.id === updated.id)
        ? prev.map(r => r.id === updated.id ? { ...r, ...updated } : r)
        : [updated, ...prev]
    )
  }, [])

  // Process offline queue when back online
  useEffect(() => {
    const handler = async (e) => {
      const queuedItems = e.detail
      for (const item of queuedItems) {
        if (item.type === 'CREATE_REPORT') {
          try {
            await reportsApi.create(item.payload)
            dequeue(item.id)
          } catch (err) {
            // Keep in queue if failed
            console.warn('Retry failed for queued report:', err)
          }
        }
      }
    }
    window.addEventListener('aidpulse:retry-queue', handler)
    return () => window.removeEventListener('aidpulse:retry-queue', handler)
  }, [dequeue])

  return {
    reports, myReports, loading, error,
    submitReport, claimReport, releaseReport, updateStatus, updateReportFromSocket,
    pendingQueue: queue,
  }
}
