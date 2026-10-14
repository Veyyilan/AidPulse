import React, { createContext, useContext, useState, useEffect, useCallback } from 'react'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser]     = useState(null)
  const [loading, setLoading] = useState(true)

  const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:4000/api'

  // Fetch current user from server — source of truth for role
  const fetchMe = useCallback(async (token) => {
    const res = await fetch(`${apiUrl}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) throw new Error('Session invalid')
    return res.json()
  }, [apiUrl])

  // On mount: restore from localStorage if token is still valid
  useEffect(() => {
    const stored = localStorage.getItem('aidpulse_user')
    if (stored) {
      try {
        const parsed = JSON.parse(stored)
        if (parsed?.token) {
          fetchMe(parsed.token)
            .then((serverUser) => {
              setUser({ ...serverUser, token: serverUser.token || parsed.token })
            })
            .catch(() => {
              localStorage.removeItem('aidpulse_user')
              localStorage.removeItem('aidpulse_submission_queue')
              setUser(null)
            })
            .finally(() => setLoading(false))
          return
        }
      } catch {}
    }
    setLoading(false)
  }, [fetchMe])

  const login = useCallback(async (identifier, password) => {
    const id = String(identifier ?? '').trim()
    // Citizens sign in with a phone; NGO/government with an email.
    const body = id.includes('@') ? { email: id, password } : { phone: id, password }
    const res = await fetch(`${apiUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.error || err.message || 'Invalid credentials')
    }
    const { token } = await res.json()
    const me = await fetchMe(token)
    const fullUser = { ...me, token }
    setUser(fullUser)
    localStorage.setItem('aidpulse_user', JSON.stringify(fullUser))
    return fullUser
  }, [apiUrl, fetchMe])

  // phone is a bare 10-digit number; the API stores it as +91XXXXXXXXXX.
  // consent=true is required by the API and recorded as consentAt.
  const register = useCallback(async (name, email, phone, password, consent = true) => {
    const body = { name, email, phone, password, consent, role: 'citizen' }
    if (!phone) delete body.phone
    const res = await fetch(`${apiUrl}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.error || err.message || 'Registration failed')
    }
    const { token } = await res.json()
    const me = await fetchMe(token)
    const fullUser = { ...me, token }
    setUser(fullUser)
    localStorage.setItem('aidpulse_user', JSON.stringify(fullUser))
    return fullUser
  }, [apiUrl, fetchMe])

  const changePassword = useCallback(async (currentPassword, newPassword) => {
    const res = await fetch(`${apiUrl}/auth/change-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${user?.token}`,
      },
      body: JSON.stringify({ currentPassword, newPassword }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.error || err.message || 'Could not change password')
    }
    setUser(prev => {
      const next = { ...prev, mustChangePassword: false }
      localStorage.setItem('aidpulse_user', JSON.stringify(next))
      return next
    })
  }, [apiUrl, user])

  const logout = useCallback(() => {
    setUser(null)
    localStorage.removeItem('aidpulse_user')
    localStorage.removeItem('aidpulse_submission_queue')
    sessionStorage.clear()
    window.dispatchEvent(new CustomEvent('aidpulse:auth-expired'))
  }, [])

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, changePassword }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
