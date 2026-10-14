import React, { createContext, useContext, useState, useEffect, useCallback } from 'react'

const OfflineContext = createContext(null)

const QUEUE_KEY = 'aidpulse_submission_queue'

function loadQueue() {
  try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]') }
  catch { return [] }
}
function saveQueue(q) {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(q))
}

export function OfflineProvider({ children }) {
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const [queue, setQueue]       = useState(loadQueue)

  useEffect(() => {
    const on  = () => setIsOnline(true)
    const off = () => setIsOnline(false)
    window.addEventListener('online',  on)
    window.addEventListener('offline', off)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [])

  // Clear on logout / auth expiry
  useEffect(() => {
    const handler = () => {
      setQueue([])
      localStorage.removeItem(QUEUE_KEY)
    }
    window.addEventListener('aidpulse:auth-expired', handler)
    return () => window.removeEventListener('aidpulse:auth-expired', handler)
  }, [])

  const enqueue = useCallback((item) => {
    setQueue(prev => {
      const next = [...prev, { ...item, id: crypto.randomUUID(), queuedAt: new Date().toISOString() }]
      saveQueue(next)
      return next
    })
  }, [])

  const dequeue = useCallback((id) => {
    setQueue(prev => {
      const next = prev.filter(i => i.id !== id)
      saveQueue(next)
      return next
    })
  }, [])

  // Attempt flush when coming back online
  useEffect(() => {
    if (isOnline && queue.length > 0) {
      window.dispatchEvent(new CustomEvent('aidpulse:retry-queue', { detail: queue }))
    }
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