import api from './axiosInstance'

// Lowercase needType for backend enum
const normalizeNeedType = (v) => String(v ?? '').trim().toLowerCase()

// ─── Auth ─────────────────────────────────────────────────────────────────
export const authApi = {
  login:    (email, password)             => api.post('/auth/login', { email, password }),
  register: (name, email, password, role) => api.post('/auth/register', { name, email, password, role }),
  me:       ()                            => api.get('/auth/me'),
}

// ─── Reports ──────────────────────────────────────────────────────────────
export const reportsApi = {
  create: (data)        => api.post('/reports', { ...data, needType: normalizeNeedType(data.needType) }),
  mine:   ()            => api.get('/reports/mine'),
  nearby: (lat, lng)    => api.get('/reports/nearby', { params: { lat, lng } }),
  all:    (filters)     => api.get('/reports', { params: filters }),
  claim:  (id)          => api.post(`/reports/${id}/claim`),
  release:(id)          => api.post(`/reports/${id}/release`),
  status: (id, status)  => api.patch(`/reports/${id}/status`, { status }),
}

// ─── Users (admin) ────────────────────────────────────────────────────────
export const usersApi = {
  list:    ()           => api.get('/users'),
  suspend: (id)         => api.post(`/users/${id}/suspend`),
  restore: (id)         => api.post(`/users/${id}/restore`),
}

// ─── Stats ────────────────────────────────────────────────────────────────
export const statsApi = {
  overview: ()          => api.get('/stats/overview'),
  gaps:     ()          => api.get('/stats/gaps'),
  clusters: ()          => api.get('/stats/clusters'),
}
