import React, { createContext, useContext, useState, useEffect, useCallback } from 'react'

const OfflineContext = createContext(null)

export function OfflineProvider({ children }) {
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const [queue, setQueue] = useState(() => {
    try { return JSON.parse(localStorage.getItem('aidpulse_submission_queue') || '[]') } catch { return [] }
  })

  useEffect(() => {
    const on  = () => setIsOnline(true)
    const off = () => setIsOnline(false)
    window.addEventListener('online',  on)
    window.addEventListener('offline', off)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [])

  // Clear queue when auth expires (user logs out or token invalid)
  useEffect(() => {
    const handler = () => {
      setQueue([])
      localStorage.removeItem('aidpulse_submission_queue')
    }
    window.addEventListener('aidpulse:auth-expired', handler)
    return () => window.removeEventListener('aidpulse:auth-expired', handler)
  }, [])

  const saveQueue = useCallback((q) => {
    setQueue(q)
    localStorage.setItem('aidpulse_submission_queue', JSON.stringify(q))
  }, [])

  const enqueue = useCallback((submission) => {
    const clientId = crypto.randomUUID()
    setQueue(prev => {
      const next = [...prev, { ...submission, id: Date.now(), clientId, queuedAt: new Date().toISOString() }]
      localStorage.setItem('aidpulse_submission_queue', JSON.stringify(next))
      return next
    })
  }, [])

  const dequeue = useCallback((id) => {
    setQueue(prev => {
      const next = prev.filter(item => item.id !== id)
      localStorage.setItem('aidpulse_submission_queue', JSON.stringify(next))
      return next
    })
  }, [])

  // Auto-retry when coming back online
  useEffect(() => {
    if (!isOnline || queue.length === 0) return
    window.dispatchEvent(new CustomEvent('aidpulse:retry-queue', { detail: queue }))
  }, [isOnline, queue])

  return (
    <OfflineContext.Provider value={{ isOnline, queue, enqueue, dequeue }}>
      {children}
    </OfflineContext.Provider>
  )
}

export const useOffline = () => {
  const ctx = useContext(OfflineContext)
  if (!ctx) throw new Error('useOffline must be used within OfflineProvider')
  return ctx
}