import React, { createContext, useContext, useRef, useState, useEffect, useCallback } from 'react'
import { useAuth } from './AuthContext'

const SocketContext = createContext(null)

export function SocketProvider({ children }) {
  const { user } = useAuth()
  const socketRef = useRef(null)
  const [connected, setConnected] = useState(false)
  // Accumulate real-time report updates keyed by id
  const [liveUpdates, setLiveUpdates] = useState({})
  const [gaps, setGaps] = useState([])

  const applyUpdate = useCallback((report) => {
    setLiveUpdates(prev => ({ ...prev, [report.id]: report }))
  }, [])

  useEffect(() => {
    if (!user) {
      socketRef.current?.disconnect()
      socketRef.current = null
      setConnected(false)
      setLiveUpdates({})
      setGaps([])
      return
    }

    let socket
    let mounted = true

    import('socket.io-client').then(({ io }) => {
      if (!mounted) return
      const apiBase   = import.meta.env.VITE_API_URL || 'http://localhost:4000/api'
      const socketUrl = apiBase.replace(/\/api\/?$/, '')

      socket = io(socketUrl, {
        auth: { token: user.token },
        transports: ['websocket'],
        reconnectionAttempts: 6,
        timeout: 8000,
      })

      socket.on('connect',    () => setConnected(true))
      socket.on('disconnect', () => setConnected(false))

      socket.on('report:new',            applyUpdate)
      socket.on('report:claimed',        applyUpdate)
      socket.on('report:status_updated', applyUpdate)
      socket.on('report:released',       applyUpdate)
      socket.on('gap:alert', (gap) => {
        setGaps(prev => [gap, ...prev].slice(0, 20))
      })

      socketRef.current = socket
    }).catch(() => {})

    const onExpired = () => {
      socketRef.current?.disconnect()
      socketRef.current = null
      setConnected(false)
    }
    window.addEventListener('aidpulse:auth-expired', onExpired)

    return () => {
      mounted = false
      socket?.disconnect()
      socketRef.current = null
      window.removeEventListener('aidpulse:auth-expired', onExpired)
    }
  }, [user, applyUpdate])

  const emit = useCallback((event, data) => {
    socketRef.current?.emit(event, data)
  }, [])

  return (
    <SocketContext.Provider value={{ connected, liveUpdates, gaps, applyUpdate, emit }}>
      {children}
    </SocketContext.Provider>
  )
}

export const useSocket = () => {
  const ctx = useContext(SocketContext)
  if (!ctx) throw new Error('useSocket must be used within SocketProvider')
  return ctx
}