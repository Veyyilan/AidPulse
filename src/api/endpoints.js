import api from './axiosInstance'

// Need types enum (4 only — Rescue, Medical, Food, Shelter)
// Posted lowercase to the backend.
export const NEED_TYPES = ['rescue', 'medical', 'food', 'shelter']

export const normalizeNeedType = (v) => String(v ?? '').trim().toLowerCase()

// ─── Auth ────────────────────────────────────────────────────────────────────
export const authApi = {
  // Citizens sign in with a 10-digit phone; NGO/government with an email.
  // Route to whichever field the API expects based on the identifier.
  login: (identifier, password) => {
    const id = String(identifier ?? '').trim()
    return id.includes('@')
      ? api.post('/auth/login', { email: id, password })
      : api.post('/auth/login', { phone: id, password })
  },
  // phone is a bare 10-digit Indian mobile (stored as +91XXXXXXXXXX); consent must be true.
  register: (name, email, phone, password, consent = true) =>
    api.post('/auth/register', {
      name,
      email: email || undefined,
      phone: phone || undefined,
      password,
      consent,
    }),
  me: () => api.get('/auth/me'),
  changePassword: (currentPassword, newPassword) =>
    api.post('/auth/change-password', { currentPassword, newPassword }),
}

// ─── Identity (DigiLocker scaffold; 501 in basic mode) ───────────────────────
export const identityApi = {
  mode: () => api.get('/identity/mode'),
  digilockerStart: () => api.get('/identity/digilocker/start'),
}

// ─── Reports ─────────────────────────────────────────────────────────────────
// A report carries an array of need types; each need is claimed separately.
export const reportsApi = {
  // data: { needs: ['rescue','medical'], lat, lng, accuracyMeters?, clientId? }
  create: (data) => api.post('/reports', {
    needs: [...new Set((data.needs || []).map(normalizeNeedType))],
    lat: data.lat,
    lng: data.lng,
    accuracyMeters: data.accuracyMeters ?? undefined,
    clientId: data.clientId,
  }),
  mine: () => api.get('/reports/mine'),
  all: (filters) => api.get('/reports', { params: filters }),

  // Claim / progress / release one need inside a report.
  claimNeed:   (id, needType) => api.post(`/reports/${id}/needs/${normalizeNeedType(needType)}/claim`),
  releaseNeed: (id, needType) => api.post(`/reports/${id}/needs/${normalizeNeedType(needType)}/release`),
  needStatus:  (id, needType, status) =>
    api.patch(`/reports/${id}/needs/${normalizeNeedType(needType)}/status`, { status }),
}

// ─── Government ──────────────────────────────────────────────────────────────
export const govApi = {
  listNgos: () => api.get('/gov/ngos'),
  // { name, email, capabilities: string[], phone?, organizationName?, password? }
  // Response: { ngo, tempPassword }.
  createNgo: (data) => api.post('/gov/ngos', data),
  suspend: (id) => api.post(`/gov/users/${id}/suspend`),
  restore: (id) => api.post(`/gov/users/${id}/restore`),
  // { reportId, needType? } — releases claimed needs on a report.
  forceRelease: (reportId, needType) =>
    api.post('/gov/force-release', needType ? { reportId, needType } : { reportId }),
  gaps: () => api.get('/gov/gaps'),
  scanGaps: () => api.post('/gov/gaps/scan'),
  clusters: () => api.get('/gov/clusters'),
  flags: () => api.get('/gov/flags'),
}
