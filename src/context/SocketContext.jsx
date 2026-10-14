import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react'
import { useAuth } from './AuthContext'

const SocketContext = createContext(null)

const INITIAL_STATE = {
  reports: [],
  gaps: [],
  connected: false,
}

export function SocketProvider({ children }) {
  const { user } = useAuth()
  const socketRef = useRef(null)
  const [state, setState] = useState(INITIAL_STATE)
  const [connected, setConnected] = useState(false)

  const updateReport = useCallback((updatedReport) => {
    setState(prev => ({
      ...prev,
      reports: prev.reports.some(r => r.id === updatedReport.id)
        ? prev.reports.map(r => r.id === updatedReport.id ? { ...r, ...updatedReport } : r)
        : [updatedReport, ...prev.reports],
    }))
  }, [])

  useEffect(() => {
    if (!user) {
      // Disconnect if no user
      socketRef.current?.disconnect()
      socketRef.current = null
      setConnected(false)
      return
    }

    let socket
    import('socket.io-client').then(({ io }) => {
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:4000'
      socket = io(apiUrl, {
        auth: { token: user.token },
        transports: ['websocket'],
        reconnectionAttempts: 5,
        timeout: 8000,
      })

      socket.on('connect', () => setConnected(true))
      socket.on('disconnect', () => setConnected(false))

      socket.on('report:new',           updateReport)
      socket.on('report:claimed',       updateReport)
      socket.on('report:status_updated',updateReport)
      socket.on('report:released',      updateReport)
      socket.on('gap:alert', (gap) => {
        setState(prev => ({ ...prev, gaps: [gap, ...prev.gaps].slice(0, 20) }))
      })

      socketRef.current = socket
    }).catch(() => {})

    // Listen for auth expiration (401) to force reconnect with new token
    const handleAuthExpired = () => {
      socketRef.current?.disconnect()
      socketRef.current = null
    }
    window.addEventListener('aidpulse:auth-expired', handleAuthExpired)

    return () => {
      socket?.disconnect()
      socketRef.current = null
      window.removeEventListener('aidpulse:auth-expired', handleAuthExpired)
    }
  }, [user, updateReport])

  // Reconnect when token changes (e.g., after refresh)
  useEffect(() => {
    if (!user) return
    if (socketRef.current?.connected && socketRef.current.io.opts.auth.token !== user.token) {
      socketRef.current.disconnect()
      socketRef.current = null
      // The main effect above will recreate with new token
    }
  }, [user?.token])

  const emit = useCallback((event, data) => {
    socketRef.current?.emit(event, data)
  }, [])

  return (
    <SocketContext.Provider value={{ ...state, connected, emit, updateReport }}>
      {children}
    </SocketContext.Provider>
  )
}

export const useSocket = () => {
  const ctx = useContext(SocketContext)
  if (!ctx) throw new Error('useSocket must be used within SocketProvider')
  return ctx
}