function plain(doc) {
  if (!doc) return null;
  return typeof doc.toObject === 'function' ? doc.toObject() : doc;
}

function idOf(value) {
  return value ? String(value) : null;
}

/** Serialise a user for API responses (never exposes passwordHash or identityRefHash). */
export function serializeUser(doc) {
  const u = plain(doc);
  if (!u) return null;
  return {
    id: String(u._id),
    name: u.name,
    phone: u.phone ?? null,
    email: u.email ?? null,
    role: u.role,
    capabilities: Array.isArray(u.capabilities) ? u.capabilities : [],
    organizationName: u.organizationName ?? null,
    identityVerified: Boolean(u.identityVerified),
    verifiedName: u.verifiedName ?? null,
    mustChangePassword: Boolean(u.mustChangePassword),
    isSuspended: Boolean(u.isSuspended),
    consentAt: u.consentAt ?? null,
    createdAt: u.createdAt,
  };
}

/** Serialise a user together with their freshly-signed token. */
export function serializeAuth(doc, token) {
  return { ...serializeUser(doc), token };
}

/** Serialise one need subdocument. */
export function serializeNeed(need) {
  const n = plain(need);
  if (!n) return null;
  return {
    type: n.type,
    status: n.status,
    claimedBy: idOf(n.claimedBy),
    claimedAt: n.claimedAt ?? null,
    resolvedAt: n.resolvedAt ?? null,
    updatedAt: n.updatedAt ?? null,
  };
}

/**
 * Serialise a report to the API shape.
 * `options.mergedFrom` records the child that just merged into this primary.
 * `options.hideReporter` omits `reportedBy` (used for the citizen feed).
 */
export function serializeReport(doc, { mergedFrom, hideReporter = false } = {}) {
  const r = plain(doc);
  if (!r) return null;
  const coords = r.location?.coordinates || [];
  const [lng, lat] = coords;
  const out = {
    id: String(r._id),
    reportedBy: hideReporter ? null : idOf(r.reportedBy),
    location: r.location ?? null,
    lat: lat ?? null,
    lng: lng ?? null,
    accuracyMeters: r.accuracyMeters ?? null,
    needs: Array.isArray(r.needs) ? r.needs.map(serializeNeed) : [],
    mergedInto: idOf(r.mergedInto),
    reporterCount: r.reporterCount ?? 1,
    flags: Array.isArray(r.flags) ? r.flags : [],
    createdAt: r.createdAt,
  };
  if (mergedFrom !== undefined) out.mergedFrom = idOf(mergedFrom);
  return out;
}

export function serializeReports(docs = [], options = {}) {
  return docs.map((doc) => serializeReport(doc, options));
}

export function serializeAudit(doc) {
  const a = plain(doc);
  if (!a) return null;
  return {
    id: String(a._id),
    reportId: String(a.reportId),
    needType: a.needType,
    actorId: a.actorId ? String(a.actorId) : null,
    action: a.action,
    timestamp: a.timestamp,
  };
}
