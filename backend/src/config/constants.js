export const ROLES = ['citizen', 'ngo', 'government', 'admin'];

// Spec enums, plus `water` which the existing UI emits.
export const NEED_TYPES = ['food', 'medical', 'shelter', 'rescue', 'water'];

export const REPORT_STATUSES = [
  'pending',
  'claimed',
  'in_progress',
  'resolved',
  'cannot_fulfill',
];

// Statuses that count as "still open" for duplicate detection / gaps.
export const OPEN_STATUSES = ['pending', 'claimed', 'in_progress'];

export const REPORT_SOURCES = ['app', 'sms', 'operator'];

export const AUDIT_ACTIONS = ['claimed', 'released', 'force_released', 'resolved'];

// Duplicate detection window + radius.
export const DUPLICATE_WINDOW_MS = 2 * 60 * 60 * 1000; // 2 hours
export const DUPLICATE_RADIUS_M = 150; // metres

// Socket rooms keyed by role.
export const ROOM_BY_ROLE = {
  ngo: 'ngo-room',
  government: 'control-room',
  admin: 'admin-room',
};

// Rooms that should observe the live operational feed.
export const OPERATIONAL_ROOMS = ['ngo-room', 'control-room', 'admin-room'];

// Human labels used when serialising to the frontend shape.
export const NEED_LABELS = {
  food: 'Food',
  medical: 'Medical',
  shelter: 'Shelter',
  rescue: 'Rescue',
  water: 'Water',
};
