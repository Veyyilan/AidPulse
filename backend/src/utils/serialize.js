import { NEED_LABELS } from '../config/constants.js';

function plain(doc) {
  if (!doc) return null;
  return typeof doc.toObject === 'function' ? doc.toObject() : doc;
}

/** Serialise a user for API responses (never exposes passwordHash). */
export function serializeUser(doc) {
  const u = plain(doc);
  if (!u) return null;
  return {
    id: String(u._id),
    name: u.name,
    email: u.email,
    phone: u.phone ?? null,
    role: u.role,
    organizationName: u.organizationName ?? null,
    status: u.isSuspended ? 'suspended' : 'active',
    isSuspended: Boolean(u.isSuspended),
    reports: u.reports ?? undefined,
    createdAt: u.createdAt,
  };
}

/** Serialise a user together with their freshly-signed token. */
export function serializeAuth(doc, token) {
  return { ...serializeUser(doc), token };
}

/**
 * Serialise a report into the shared shape used by both the spec API and the
 * frontend (frontend expects `id`, `lat`, `lng`, `accuracy`, capitalised
 * `needType`, and an optional `distance`).
 */
export function serializeReport(doc, { distanceKm } = {}) {
  const r = plain(doc);
  if (!r) return null;
  const coords = r.location?.coordinates || [];
  const [lng, lat] = coords;
  const out = {
    id: String(r._id),
    reportedBy: r.reportedBy ? String(r.reportedBy) : null,
    needType: NEED_LABELS[r.needType] || r.needType,
    needTypeRaw: r.needType,
    description: r.description,
    location: r.location,
    lat,
    lng,
    accuracyMeters: r.accuracyMeters ?? null,
    accuracy: r.accuracyMeters ?? null,
    status: r.status,
    claimedBy: r.claimedBy ? String(r.claimedBy) : null,
    claimedAt: r.claimedAt ?? null,
    resolvedAt: r.resolvedAt ?? null,
    duplicateOf: r.duplicateOf ? String(r.duplicateOf) : null,
    duplicateCount: r.duplicateCount ?? 0,
    source: r.source,
    createdAt: r.createdAt,
  };
  if (distanceKm !== undefined && distanceKm !== null) {
    out.distance = Number(distanceKm.toFixed(2));
  }
  return out;
}

export function serializeReports(docsWithDistance = []) {
  // Accepts either raw docs or { doc, distanceKm } pairs.
  return docsWithDistance.map((entry) =>
    entry && entry.doc
      ? serializeReport(entry.doc, { distanceKm: entry.distanceKm })
      : serializeReport(entry),
  );
}

export function serializeAudit(doc) {
  const a = plain(doc);
  if (!a) return null;
  return {
    id: String(a._id),
    reportId: String(a.reportId),
    actorId: a.actorId ? String(a.actorId) : null,
    action: a.action,
    timestamp: a.timestamp,
  };
}
