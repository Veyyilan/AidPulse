import api from './axiosInstance'

// Need types enum (4 only — Rescue, Medical, Food, Shelter)
// Posted as lowercase to backend
export const NEED_TYPES = ['rescue', 'medical', 'food', 'shelter']

export const normalizeNeedType = (v) => String(v ?? '').trim().toLowerCase()

// ─── Auth ────────────────────────────────────────────────────────────────────
export const authApi = {
  login:    (email, password)  => api.post('/auth/login', { email, password }),
  // phone is +91XXXXXXXXXX
  register: (name, email, phone, password) =>
    api.post('/auth/register', { name, email, phone: phone || undefined, password, role: 'citizen' }),
  me: () => api.get('/auth/me'),
  // DigiLocker: initiate redirect (backend returns {url})
  digilockerStart: () => api.post('/auth/digilocker/start'),
}

// ─── Reports ─────────────────────────────────────────────────────────────────
// The new shape: a report carries an array of needTypes (multi-select).
// Each needType within a report is claimed separately (needClaims).
export const reportsApi = {
  // data: { needTypes: ['rescue','medical'], lat, lng, accuracyMeters, clientId }
  create:  (data)       => api.post('/reports', {
    ...data,
    needTypes: (data.needTypes || []).map(normalizeNeedType),
  }),
  mine:    ()           => api.get('/reports/mine'),
  nearby:  (lat, lng)   => api.get('/reports/nearby', { params: { lat, lng } }),
  all:     (filters)    => api.get('/reports', { params: filters }),

  // Claim a specific need within a report:  POST /reports/:id/claim/:needType
  claimNeed:   (id, needType) => api.post(`/reports/${id}/claim/${normalizeNeedType(needType)}`),
  releaseNeed: (id, needType) => api.post(`/reports/${id}/release/${normalizeNeedType(needType)}`),
  // Update status of a specific need: PATCH /reports/:id/needs/:needType/status
  needStatus:  (id, needType, status) =>
    api.patch(`/reports/${id}/needs/${normalizeNeedType(needType)}/status`, { status }),

  // Legacy single-need claim (fallback if backend not yet updated)
  claim:   (id)         => api.post(`/reports/${id}/claim`),
  release: (id)         => api.post(`/reports/${id}/release`),
  status:  (id, status) => api.patch(`/reports/${id}/status`, { status }),
}

// ─── Users (government manages NGOs) ─────────────────────────────────────────
export const usersApi = {
  list:        ()      => api.get('/users'),
  // capabilities: string[] e.g. ['medical','food']
  registerNgo: (data)  => api.post('/users/register-ngo', data),
  suspend:     (id)    => api.post(`/users/${id}/suspend`),
  restore:     (id)    => api.post(`/users/${id}/restore`),
  forceRelease:(id)    => api.post(`/users/${id}/force-release`),
}

// ─── Stats ────────────────────────────────────────────────────────────────────
export const statsApi = {
  overview: () => api.get('/stats/overview'),
  gaps:     () => api.get('/stats/gaps'),
  clusters: () => api.get('/stats/clusters'),
}
