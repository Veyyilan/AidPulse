// ─── Need types (4, no Water) ────────────────────────────────────────────────
export const NEED_TYPES = ['rescue', 'medical', 'food', 'shelter']

export const NEED_LABELS = {
  rescue:  'Rescue',
  medical: 'Medical',
  food:    'Food',
  shelter: 'Shelter',
}

// Shape: circle=medical, triangle=rescue, square=food, diamond=shelter
export const NEED_SHAPES = {
  rescue:  'triangle',
  medical: 'circle',
  food:    'square',
  shelter: 'diamond',
}

// Status progression
export const NEED_STATUS_LABELS = {
  sent:        'Sent',
  pending:     'Pending',
  claiming:    'Claiming…',
  claimed:     'Claimed',
  on_the_way:  'On the way',
  in_progress: 'In progress',
  resolved:    'Resolved',
  released:    'Released',
}

// NGO capability options (maps to need types)
export const NGO_CAPABILITIES = NEED_TYPES

// Normalize a backend report into our frontend shape (handles both old and new API)
export function normalizeReport(raw) {
  if (!raw) return null
  // Multi-need shape: { needs: [{needType, status, claimedBy}] }
  let needs = raw.needs
  if (!needs && raw.needType) {
    // Legacy single-need report: wrap it
    needs = [{ needType: raw.needType?.toLowerCase?.() || raw.needType, status: raw.status || 'pending', claimedBy: raw.claimedBy || null }]
  }
  needs = (needs || []).map(n => ({
    needType: n.needType?.toLowerCase?.() || n.needType || 'rescue',
    status:   n.status   || 'pending',
    claimedBy: n.claimedBy || null,
  }))

  const lat = raw.lat ?? raw.location?.coordinates?.[1]
  const lng = raw.lng ?? raw.location?.coordinates?.[0]

  return {
    id:           raw.id || String(raw._id),
    reportedBy:   raw.reportedBy ? String(raw.reportedBy) : null,
    needs,
    // For backwards compat, expose primary needType
    needType:     needs[0]?.needType || 'rescue',
    lat:          typeof lat === 'number' ? lat : null,
    lng:          typeof lng === 'number' ? lng : null,
    accuracyMeters: raw.accuracyMeters ?? raw.accuracy ?? null,
    status:       raw.status || 'pending',
    distance:     raw.distance ?? null,
    duplicateCount: raw.duplicateCount ?? 0,
    createdAt:    raw.createdAt,
    clientId:     raw.clientId,
    _queued:      raw._queued || false,
  }
}
