import axios from 'axios'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:4000/api',
  timeout: 12000,
  headers: { 'Content-Type': 'application/json' },
})

// Attach JWT on every request
api.interceptors.request.use((config) => {
  try {
    const stored = localStorage.getItem('aidpulse_user')
    if (stored) {
      const u = JSON.parse(stored)
      if (u?.token) config.headers.Authorization = `Bearer ${u.token}`
    }
  } catch {}
  return config
})

// 401: clear session, disconnect socket, clear queue, redirect
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('aidpulse_user')
      localStorage.removeItem('aidpulse_submission_queue')
      sessionStorage.clear()
      window.dispatchEvent(new CustomEvent('aidpulse:auth-expired'))
      if (window.location.pathname !== '/login') {
        window.location.href = '/login'
      }
    }
    return Promise.reject(err)
  }
)

export default api
