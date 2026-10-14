import React, { createContext, useContext, useState, useEffect, useCallback } from 'react'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:4000/api'

  // Fetch current user from server (source of truth for role)
  const fetchMe = useCallback(async (token) => {
    const res = await fetch(`${apiUrl}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) throw new Error('Failed to fetch user')
    return res.json()
  }, [apiUrl])

  // Initialize from localStorage, but verify with server
  useEffect(() => {
    const stored = localStorage.getItem('aidpulse_user')
    if (stored) {
      try {
        const parsed = JSON.parse(stored)
        if (parsed.token) {
          fetchMe(parsed.token)
            .then((serverUser) => {
              // Server response is authoritative for role; keep the token.
              setUser({ ...serverUser, token: serverUser.token || parsed.token })
            })
            .catch(() => {
              localStorage.removeItem('aidpulse_user')
              setUser(null)
            })
            .finally(() => setLoading(false))
          return
        }
      } catch (_) {}
    }
    setLoading(false)
  }, [fetchMe])

  const login = useCallback(async (email, password) => {
    const res = await fetch(`${apiUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.error || 'Invalid credentials')
    }
    const { token } = await res.json()
    // Fetch authoritative user data from server (includes correct role)
    const me = await fetchMe(token)
    const fullUser = { ...me, token }
    setUser(fullUser)
    localStorage.setItem('aidpulse_user', JSON.stringify(fullUser))
    return fullUser
  }, [apiUrl, fetchMe])

  const register = useCallback(async (name, email, password, role) => {
    const res = await fetch(`${apiUrl}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password, role }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.error || 'Registration failed')
    }
    const { token } = await res.json()
    // Fetch authoritative user data from server
    const me = await fetchMe(token)
    const fullUser = { ...me, token }
    setUser(fullUser)
    localStorage.setItem('aidpulse_user', JSON.stringify(fullUser))
    return fullUser
  }, [apiUrl, fetchMe])

  const logout = useCallback(() => {
    setUser(null)
    localStorage.removeItem('aidpulse_user')
    // Notify socket + offline queue to clean up
    window.dispatchEvent(new CustomEvent('aidpulse:auth-expired'))
  }, [])

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
