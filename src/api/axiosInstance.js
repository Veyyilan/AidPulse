import axios from 'axios'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:4000/api',
  timeout: 10000,
  headers: { 'Content-Type': 'application/json' },
})

// Attach JWT from localStorage on every request
api.interceptors.request.use((config) => {
  const stored = localStorage.getItem('aidpulse_user')
  if (stored) {
    try {
      const user = JSON.parse(stored)
      if (user?.token) config.headers.Authorization = `Bearer ${user.token}`
    } catch (_) {}
  }
  return config
})

// 401 interceptor: clear session, notify socket to disconnect, redirect to login
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('aidpulse_user')
      // Notify socket context to disconnect
      window.dispatchEvent(new CustomEvent('aidpulse:auth-expired'))
      window.location.href = '/login'
    }
    return Promise.reject(err)
  }
)

export default api
