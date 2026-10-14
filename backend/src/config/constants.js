export const ROLES = ['citizen', 'ngo', 'government'];

// Need types an NGO may hold as capabilities, and a report may request.
export const NEED_TYPES = ['rescue', 'medical', 'food', 'shelter'];

// Per-need lifecycle. Forward only: pending -> claimed -> in_progress -> resolved.
export const NEED_STATUSES = ['pending', 'claimed', 'in_progress', 'resolved'];
export const OPEN_STATUSES = ['pending', 'claimed', 'in_progress'];

// Ordered from least to most advanced. Status transitions may only move right.
export const STATUS_ORDER = { pending: 0, claimed: 1, in_progress: 2, resolved: 3 };

export const AUDIT_ACTIONS = [
  'claimed',
  'released',
  'force_released',
  'status_updated',
  'resolved',
];

// ─── Deployment region (Tamil Nadu) ────────────────────────────────────────
export const REGION_BOUNDS = {
  minLat: 7.9,
  maxLat: 13.7,
  minLng: 76.1,
  maxLng: 80.5,
};

// ─── Merge (duplicate) detection windows ───────────────────────────────────
// Any other user's open primary within 150 m and 2 hours.
export const MERGE_RADIUS_M = 150;
export const MERGE_WINDOW_MS = 2 * 60 * 60 * 1000; // 2 hours
// The same user's open primary within 300 m and 6 hours.
export const SAME_USER_MERGE_RADIUS_M = 300;
export const SAME_USER_MERGE_WINDOW_MS = 6 * 60 * 60 * 1000; // 6 hours

// ─── Spam flags ────────────────────────────────────────────────────────────
export const SPAM_ACCURACY_THRESHOLD_M = 1000;
export const SPAM_MERGE_THRESHOLD = 5;

// ─── Gap detection ─────────────────────────────────────────────────────────
// 0.01-degree grid cell (~1.1 km at the equator).
export const GAP_CELL_DEGREES = 0.01;

// ─── Socket.IO rooms ───────────────────────────────────────────────────────
// Every authenticated socket joins `user:<id>`.
// NGOs additionally join `ngo` and `cap:<capability>` for each capability.
// Government sockets join `government`.
export const ROOMS = {
  ngo: 'ngo',
  government: 'government',
  capability: (cap) => `cap:${cap}`,
  user: (id) => `user:${id}`,
};

// ─── Socket events ─────────────────────────────────────────────────────────
export const EVENTS = {
  REPORT_NEW: 'report:new',
  REPORT_CLAIMED: 'report:claimed',
  REPORT_STATUS_UPDATED: 'report:status_updated',
  REPORT_RELEASED: 'report:released',
  GAP_ALERT: 'gap:alert',
};

export const NEED_LABELS = {
  food: 'Food',
  medical: 'Medical',
  shelter: 'Shelter',
  rescue: 'Rescue',
};
