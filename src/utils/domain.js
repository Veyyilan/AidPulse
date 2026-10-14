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

// Normalize a backend report into our frontend shape.
// The API need objects use `type`; we expose them as `needType` for the UI.
export function normalizeReport(raw) {
  if (!raw) return null

  let needs = raw.needs
  if (!needs && raw.needType) {
    // Legacy single-need report: wrap it
    needs = [{ type: raw.needType, status: raw.status || 'pending', claimedBy: raw.claimedBy || null }]
  }
  needs = (needs || []).map(n => ({
    needType:  (n.type || n.needType || '').toLowerCase() || 'rescue',
    status:    n.status || 'pending',
    claimedBy: n.claimedBy ? String(n.claimedBy) : null,
    claimedAt: n.claimedAt || null,
    updatedAt: n.updatedAt || null,
  }))

  const lat = raw.lat ?? raw.location?.coordinates?.[1]
  const lng = raw.lng ?? raw.location?.coordinates?.[0]

  // The backend has no top-level status — derive one from the needs so the
  // list filters keep working.
  const states = needs.map(n => n.status)
  const aggregate =
    states.length > 0 && states.every(s => s === 'resolved') ? 'resolved'
    : states.some(s => s === 'in_progress')                  ? 'in_progress'
    : states.some(s => s === 'claimed')                      ? 'claimed'
    : 'pending'

  return {
    id:           raw.id || String(raw._id),
    reportedBy:   raw.reportedBy ? String(raw.reportedBy) : null,
    needs,
    // For backwards compat, expose primary needType
    needType:     needs[0]?.needType || 'rescue',
    lat:          typeof lat === 'number' ? lat : null,
    lng:          typeof lng === 'number' ? lng : null,
    accuracyMeters: raw.accuracyMeters ?? raw.accuracy ?? null,
    status:       raw.status || aggregate,
    distance:     raw.distance ?? null,
    // `mergedCount` comes from /gov/clusters; otherwise infer from reporterCount.
    duplicateCount: raw.mergedCount ?? Math.max(0, (raw.reporterCount ?? 1) - 1),
    reporterCount:  raw.reporterCount ?? 1,
    flags:        raw.flags || [],
    mergedInto:   raw.mergedInto ? String(raw.mergedInto) : null,
    createdAt:    raw.createdAt,
    clientId:     raw.clientId,
    _queued:      raw._queued || false,
  }
}
