import { ClaimAudit } from '../models/ClaimAudit.js';

/**
 * Append an immutable audit row. Callers MUST await this before emitting any
 * socket event, so clients never observe an event for a write that failed.
 */
export async function recordAudit({ reportId, needType, actorId = null, action }) {
  return ClaimAudit.create({ reportId, needType, actorId, action });
}

export async function getAuditTrail(reportId) {
  return ClaimAudit.find({ reportId }).sort({ timestamp: 1 });
}
