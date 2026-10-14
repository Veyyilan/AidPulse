import { Report } from '../models/Report.js';
import { ApiError } from '../utils/ApiError.js';
import { recordAudit } from './auditService.js';
import { toGeoPoint } from '../utils/geo.js';
import { serializeReport } from '../utils/serialize.js';
import { emitToRooms, reportRooms, needRooms } from '../realtime/index.js';
import { env } from '../config/env.js';
import {
  NEED_TYPES,
  STATUS_ORDER,
  MERGE_RADIUS_M,
  MERGE_WINDOW_MS,
  SAME_USER_MERGE_RADIUS_M,
  SAME_USER_MERGE_WINDOW_MS,
  SPAM_ACCURACY_THRESHOLD_M,
  SPAM_MERGE_THRESHOLD,
  EVENTS,
  ROOMS,
} from '../config/constants.js';

// ─── Validation ────────────────────────────────────────────────────────────

/** needs must be a non-empty set of unique valid types. */
export function validateNeeds(needs) {
  if (!Array.isArray(needs) || needs.length === 0) {
    throw ApiError.unprocessable('needs must be a non-empty array', [
      { field: 'needs', message: 'at least one need type is required' },
    ]);
  }
  const cleaned = needs.map((n) => String(n ?? '').trim().toLowerCase());
  const invalid = cleaned.filter((t) => !NEED_TYPES.includes(t));
  if (invalid.length) {
    throw ApiError.unprocessable('Invalid need type', [
      { field: 'needs', message: `unsupported: ${invalid.join(', ')}` },
    ]);
  }
  const unique = [...new Set(cleaned)];
  if (unique.length !== cleaned.length) {
    throw ApiError.unprocessable('needs must be unique', [
      { field: 'needs', message: 'duplicate need types are not allowed' },
    ]);
  }
  return unique;
}

// ─── Idempotency ───────────────────────────────────────────────────────────

/**
 * Idempotency lookup, scoped to the reporting user: a clientId can only ever
 * resolve to a report that the same user created.
 */
export async function findReportByClientId(clientId, userId) {
  if (!clientId || !userId) return null;
  return Report.findOne({ clientId, reportedBy: userId });
}

// ─── Merge (deterministic, no LLM) ─────────────────────────────────────────

/**
 * Find the oldest open primary (mergedInto null) this new report should merge
 * into. Any other user's primary within 150 m / 2 h, or the same user's within
 * 300 m / 6 h. Only ever returns a report strictly OLDER than the new one
 * (createdAt, then _id) so merges can never form a cycle.
 */
async function findMergeTarget(report, userId) {
  const newCreatedMs = new Date(report.createdAt).getTime();
  const sameUserSince = new Date(newCreatedMs - SAME_USER_MERGE_WINDOW_MS);

  const candidates = await Report.aggregate([
    {
      $geoNear: {
        near: report.location,
        distanceField: 'distanceMeters',
        maxDistance: SAME_USER_MERGE_RADIUS_M,
        spherical: true,
        query: {
          _id: { $ne: report._id },
          mergedInto: null,
          createdAt: { $gte: sameUserSince },
        },
      },
    },
    // Oldest first; _id breaks createdAt ties deterministically.
    { $sort: { createdAt: 1, _id: 1 } },
  ]);

  const userStr = String(userId);
  const newIdStr = String(report._id);

  for (const c of candidates) {
    const cCreatedMs = new Date(c.createdAt).getTime();
    const strictlyOlder =
      cCreatedMs < newCreatedMs || (cCreatedMs === newCreatedMs && String(c._id) < newIdStr);
    if (!strictlyOlder) continue;

    const sameUser = String(c.reportedBy) === userStr;
    const ageMs = newCreatedMs - cCreatedMs; // >= 0, the candidate is strictly older
    if (sameUser) {
      if (c.distanceMeters <= SAME_USER_MERGE_RADIUS_M && ageMs <= SAME_USER_MERGE_WINDOW_MS) {
        return c;
      }
    } else if (c.distanceMeters <= MERGE_RADIUS_M && ageMs <= MERGE_WINDOW_MS) {
      return c;
    }
  }
  return null;
}

/**
 * Follow `mergedInto` links to the current root primary. A concurrent merge may
 * have folded the chosen target into an even older report between the search
 * and the merge; following the link keeps depth at 1.
 */
async function resolveRootPrimary(doc) {
  if (!doc || !doc._id) return null;
  // Re-fetch: the cached candidate may have been folded into an older report
  // since the search ran.
  let current = await Report.findById(doc._id);
  for (let hops = 0; hops < 5 && current && current.mergedInto; hops += 1) {
    current = await Report.findById(current.mergedInto);
  }
  return current && !current.mergedInto ? current : null;
}

/**
 * Merge `child` into `primary`:
 *   - repoint every report that pointed at the child to the primary (depth 1)
 *   - set the child's mergedInto
 *   - increment the primary's reporterCount
 *   - carry the child's needs across, preserving any active claim and never
 *     creating a second need of the same type
 *   - flag the primary when one user contributes more than the merge threshold
 */
async function mergeInto(primary, child) {
  const primaryId = primary._id;
  const childId = child._id;

  await Report.updateMany({ mergedInto: childId }, { $set: { mergedInto: primaryId } });
  await Report.updateOne({ _id: childId }, { $set: { mergedInto: primaryId } });
  await Report.updateOne({ _id: primaryId }, { $inc: { reporterCount: 1 } });

  // Carry the child's needs across without losing a claim and without adding a
  // duplicate. Re-read the primary first: a concurrent merge may have changed
  // its needs since the search ran. For each of the child's need types:
  //   - the primary lacks it      -> add it with the child's exact state
  //   - the child is further along -> carry its state (e.g. an active claim) over
  //   - otherwise                 -> keep the primary's (more advanced) need
  // Either way there is never more than one need per type.
  const fresh = await Report.findById(primaryId);
  const primaryByType = new Map((fresh?.needs || []).map((n) => [n.type, n]));
  const now = new Date();

  const snapshot = (n) => ({
    type: n.type,
    status: n.status,
    claimedBy: n.claimedBy ?? null,
    claimedAt: n.claimedAt ?? null,
    resolvedAt: n.resolvedAt ?? null,
    updatedAt: n.updatedAt ?? now,
  });

  for (const childNeed of child.needs || []) {
    const { type } = childNeed;
    const existing = primaryByType.get(type);

    if (!existing) {
      // The $not/$elemMatch guard makes concurrent merges safe: a type is only
      // pushed by the first writer that observes it missing.
      const res = await Report.updateOne(
        { _id: primaryId, mergedInto: null, needs: { $not: { $elemMatch: { type } } } },
        { $push: { needs: snapshot(childNeed) } },
      );
      if (res.modifiedCount === 1) primaryByType.set(type, childNeed);
    } else if (STATUS_ORDER[childNeed.status] > STATUS_ORDER[existing.status]) {
      // The child's need is further along (e.g. already claimed). Move the claim
      // onto the primary rather than dropping it. Conditional on the exact
      // current status so a concurrent update is never clobbered.
      const res = await Report.updateOne(
        { _id: primaryId, mergedInto: null, needs: { $elemMatch: { type, status: existing.status } } },
        {
          $set: {
            'needs.$.status': childNeed.status,
            'needs.$.claimedBy': childNeed.claimedBy ?? null,
            'needs.$.claimedAt': childNeed.claimedAt ?? null,
            'needs.$.resolvedAt': childNeed.resolvedAt ?? null,
            'needs.$.updatedAt': childNeed.updatedAt ?? now,
          },
        },
      );
      if (res.modifiedCount === 1) primaryByType.set(type, childNeed);
    }
  }

  // Spam: more than N merges into one report from the same user.
  const fromUser = await Report.countDocuments({ mergedInto: primaryId, reportedBy: child.reportedBy });
  if (fromUser > SPAM_MERGE_THRESHOLD) {
    await Report.updateOne({ _id: primaryId }, { $addToSet: { flags: 'excessive_merges' } });
  }
}

// ─── Create ────────────────────────────────────────────────────────────────

/**
 * Create a report, then run the merge deterministically. Emissions happen only
 * after the merge completes:
 *   - merged  -> report:status_updated for the primary
 *   - not     -> report:new for the new report
 */
export async function createReport({ userId, needs, lat, lng, accuracyMeters = null, clientId }) {
  const normalizedNeeds = validateNeeds(needs);
  const now = new Date();

  const flags = [];
  if (Number.isFinite(accuracyMeters) && accuracyMeters > SPAM_ACCURACY_THRESHOLD_M) {
    flags.push('low_accuracy');
  }

  const report = await Report.create({
    reportedBy: userId,
    ...(clientId ? { clientId } : {}),
    location: toGeoPoint(lat, lng),
    accuracyMeters: accuracyMeters ?? null,
    needs: normalizedNeeds.map((type) => ({
      type,
      status: 'pending',
      claimedBy: null,
      claimedAt: null,
      resolvedAt: null,
      updatedAt: now,
    })),
    mergedInto: null,
    reporterCount: 1,
    flags,
    createdAt: now,
  });

  let primary = await findMergeTarget(report, userId);

  if (!primary) {
    // A simultaneous report at the same place may still be committing and so
    // not yet visible to the first search. Retry briefly: this makes two (or
    // more) concurrent inserts deterministically collapse onto one primary
    // instead of each becoming its own primary.
    for (let attempt = 0; attempt < 5 && !primary; attempt += 1) {
      await new Promise((r) => setTimeout(r, attempt < 2 ? 3 : 10));
      primary = await findMergeTarget(report, userId);
    }
  }

  if (!primary) {
    emitToRooms(reportRooms(report), EVENTS.REPORT_NEW, serializeReport(report));
    return { report, merged: false, primary: null };
  }

  // Merge into the current root if the target was folded into an older report.
  primary = await resolveRootPrimary(primary);
  if (!primary) {
    emitToRooms(reportRooms(report), EVENTS.REPORT_NEW, serializeReport(report));
    return { report, merged: false, primary: null };
  }

  await mergeInto(primary, report);
  report.mergedInto = primary._id;

  const updatedPrimary = await Report.findById(primary._id);
  emitToRooms(
    [...reportRooms(updatedPrimary), ROOMS.user(String(updatedPrimary.reportedBy))],
    EVENTS.REPORT_STATUS_UPDATED,
    serializeReport(updatedPrimary, { mergedFrom: report._id }),
  );

  return { report, merged: true, primary: updatedPrimary };
}

// ─── Claim / status / release ──────────────────────────────────────────────

/**
 * Atomically claim one need. The $elemMatch guard is the single source of
 * truth — never read-then-write. 409 when the need is not claimable.
 */
export async function claimNeed({ reportId, needType, actor }) {
  const caps = Array.isArray(actor.capabilities) ? actor.capabilities : [];
  if (!caps.includes(needType)) {
    throw ApiError.forbidden(`Your organisation has no "${needType}" capability`);
  }

  const now = new Date();
  const result = await Report.updateOne(
    {
      _id: reportId,
      mergedInto: null,
      needs: { $elemMatch: { type: needType, status: 'pending' } },
    },
    {
      $set: {
        'needs.$.status': 'claimed',
        'needs.$.claimedBy': actor._id,
        'needs.$.claimedAt': now,
        'needs.$.updatedAt': now,
      },
    },
  );

  if (result.modifiedCount !== 1) {
    throw ApiError.conflict('Need is no longer available to claim');
  }

  // Audit first, then emit.
  await recordAudit({ reportId, needType, actorId: actor._id, action: 'claimed' });
  const report = await Report.findById(reportId);
  emitToRooms(needRooms(report, needType), EVENTS.REPORT_CLAIMED, serializeReport(report));
  return report;
}

/**
 * Move a need forward (claimed -> in_progress -> resolved). Only the claiming
 * NGO may do this, and only to a strictly more advanced status.
 */
export async function updateNeedStatus({ reportId, needType, status, actor }) {
  if (STATUS_ORDER[status] === undefined) {
    throw ApiError.unprocessable('Invalid status', [{ field: 'status', message: 'unknown status' }]);
  }

  const report = await Report.findOne({ _id: reportId, mergedInto: null });
  if (!report) throw ApiError.notFound('Report not found');
  const need = report.needs.find((n) => n.type === needType);
  if (!need) throw ApiError.notFound(`Need "${needType}" not found on report`);

  // Ownership first: a non-owner (including the previous owner after the
  // sweeper has released the claim) is always 403.
  if (String(need.claimedBy || '') !== String(actor._id)) {
    throw ApiError.forbidden('Only the claiming organisation can update this need');
  }
  // Then the transition itself. Only the single next step is allowed
  // (claimed -> in_progress -> resolved), so skipping a step is 409.
  if (STATUS_ORDER[status] !== STATUS_ORDER[need.status] + 1) {
    throw ApiError.conflict(`Cannot move need from "${need.status}" to "${status}"`);
  }

  const now = new Date();
  const patch = { 'needs.$.status': status, 'needs.$.updatedAt': now };
  if (status === 'resolved') patch['needs.$.resolvedAt'] = now;

  // Conditional on the exact current status + owner, so a concurrent change
  // can never be clobbered.
  const result = await Report.updateOne(
    {
      _id: reportId,
      mergedInto: null,
      needs: { $elemMatch: { type: needType, status: need.status, claimedBy: actor._id } },
    },
    { $set: patch },
  );
  if (result.modifiedCount !== 1) {
    throw ApiError.conflict('Need status changed concurrently; retry');
  }

  await recordAudit({
    reportId,
    needType,
    actorId: actor._id,
    action: status === 'resolved' ? 'resolved' : 'status_updated',
  });
  const updated = await Report.findById(reportId);
  emitToRooms(needRooms(updated, needType), EVENTS.REPORT_STATUS_UPDATED, serializeReport(updated));
  return updated;
}

/** Release a claimed/in_progress need back to pending (claiming NGO only). */
export async function releaseNeed({ reportId, needType, actor }) {
  const current = await Report.findOne({ _id: reportId, mergedInto: null });
  if (!current) throw ApiError.notFound('Report not found');
  const need = current.needs.find((n) => n.type === needType);
  if (!need) throw ApiError.notFound(`Need "${needType}" not found on report`);

  // A different organisation trying to release someone else's claim is 403.
  if (
    ['claimed', 'in_progress'].includes(need.status) &&
    String(need.claimedBy || '') !== String(actor._id)
  ) {
    throw ApiError.forbidden('Only the claiming organisation can release this need');
  }

  const now = new Date();
  const result = await Report.updateOne(
    {
      _id: reportId,
      mergedInto: null,
      needs: {
        $elemMatch: { type: needType, status: { $in: ['claimed', 'in_progress'] }, claimedBy: actor._id },
      },
    },
    {
      $set: {
        'needs.$.status': 'pending',
        'needs.$.claimedBy': null,
        'needs.$.claimedAt': null,
        'needs.$.updatedAt': now,
      },
    },
  );

  if (result.modifiedCount !== 1) {
    throw ApiError.conflict('Need is not currently claimed by you');
  }

  await recordAudit({ reportId, needType, actorId: actor._id, action: 'released' });
  const report = await Report.findById(reportId);
  emitToRooms(needRooms(report, needType), EVENTS.REPORT_RELEASED, serializeReport(report));
  return report;
}

/** Government override: force-release one or all claimed needs on a report. */
export async function forceReleaseNeed({ reportId, needType = null, actorId = null }) {
  const report = await Report.findOne({ _id: reportId, mergedInto: null });
  if (!report) throw ApiError.notFound('Report not found');

  const targets = report.needs.filter(
    (n) =>
      (needType ? n.type === needType : true) &&
      (n.status === 'claimed' || n.status === 'in_progress'),
  );
  if (targets.length === 0) {
    throw ApiError.conflict('No claimed needs to release on this report');
  }

  const now = new Date();
  let released = 0;
  for (const need of targets) {
    const result = await Report.updateOne(
      {
        _id: reportId,
        mergedInto: null,
        needs: { $elemMatch: { type: need.type, status: { $in: ['claimed', 'in_progress'] } } },
      },
      {
        $set: {
          'needs.$.status': 'pending',
          'needs.$.claimedBy': null,
          'needs.$.claimedAt': null,
          'needs.$.updatedAt': now,
        },
      },
    );
    if (result.modifiedCount === 1) {
      await recordAudit({ reportId, needType: need.type, actorId, action: 'force_released' });
      released += 1;
    }
  }

  const updated = await Report.findById(reportId);
  emitToRooms(reportRooms(updated), EVENTS.REPORT_RELEASED, serializeReport(updated));
  return { report: updated, released };
}

// ─── Reads ─────────────────────────────────────────────────────────────────

/**
 * Feed of primary reports (mergedInto null), filtered by role and capabilities.
 *   ngo        -> only reports with a need in the NGO's capability set
 *   government -> everything
 *   citizen    -> everything, with reporter identity hidden
 */
export async function listFeed({ role, capabilities = [], status, needType, limit = 100 }) {
  const filter = { mergedInto: null };

  const elem = {};
  if (needType) elem.type = needType;
  if (status) elem.status = status;

  if (role === 'ngo') {
    const caps = capabilities.filter((c) => NEED_TYPES.includes(c));
    if (needType) {
      if (!caps.includes(needType)) return []; // not their capability
      elem.type = needType;
    } else {
      elem.type = { $in: caps };
    }
  }

  if (Object.keys(elem).length) filter.needs = { $elemMatch: elem };

  const capped = Math.min(Math.max(Number(limit) || 100, 1), 500);
  return Report.find(filter).sort({ createdAt: -1 }).limit(capped);
}

/**
 * The reports a user contributed to. Merged children resolve through
 * mergedInto (depth is always 1) to the primary, deduplicated.
 */
export async function listMine(userId) {
  const mine = await Report.find({ reportedBy: userId }).sort({ createdAt: -1 });
  const childPrimaryIds = mine.filter((r) => r.mergedInto).map((r) => r.mergedInto);

  const primaries = childPrimaryIds.length
    ? await Report.find({ _id: { $in: childPrimaryIds } })
    : [];
  const primaryById = new Map(primaries.map((p) => [String(p._id), p]));

  const resolved = [];
  const seen = new Set();

  for (const r of mine) {
    if (r.mergedInto) continue; // own primaries first
    if (seen.has(String(r._id))) continue;
    seen.add(String(r._id));
    resolved.push(r);
  }
  for (const r of mine) {
    if (!r.mergedInto) continue;
    const primary = primaryById.get(String(r.mergedInto));
    if (primary && !seen.has(String(primary._id))) {
      seen.add(String(primary._id));
      resolved.push(primary);
    }
  }

  resolved.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return resolved;
}

// ─── Stale-claim sweeper ───────────────────────────────────────────────────

/**
 * Revert needs that have been claimed/in_progress with no update for more than
 * STALE_CLAIM_HOURS. Each update is conditional, so repeated runs are harmless
 * and a need claimed between the scan and the write is never clobbered.
 */
export async function sweepStaleClaims({ staleHours = env.staleClaimHours, now = new Date() } = {}) {
  const cutoff = new Date(now.getTime() - staleHours * 3600 * 1000);

  const candidates = await Report.find({
    mergedInto: null,
    needs: {
      $elemMatch: { status: { $in: ['claimed', 'in_progress'] }, updatedAt: { $lt: cutoff } },
    },
  }).select('_id needs');

  const released = [];

  for (const report of candidates) {
    for (const need of report.needs) {
      if (!['claimed', 'in_progress'].includes(need.status)) continue;
      if (!(need.updatedAt && new Date(need.updatedAt).getTime() < cutoff.getTime())) continue;

      const result = await Report.updateOne(
        {
          _id: report._id,
          mergedInto: null,
          needs: {
            $elemMatch: {
              type: need.type,
              status: { $in: ['claimed', 'in_progress'] },
              updatedAt: { $lt: cutoff },
            },
          },
        },
        {
          $set: {
            'needs.$.status': 'pending',
            'needs.$.claimedBy': null,
            'needs.$.claimedAt': null,
            'needs.$.updatedAt': now,
          },
        },
      );

      if (result.modifiedCount === 1) {
        await recordAudit({
          reportId: report._id,
          needType: need.type,
          actorId: null,
          action: 'force_released',
        });
        released.push({ reportId: report._id, needType: need.type });
      }
    }
  }

  const reportIds = [...new Set(released.map((r) => String(r.reportId)))];
  for (const id of reportIds) {
    const report = await Report.findById(id);
    if (report) emitToRooms(reportRooms(report), EVENTS.REPORT_RELEASED, serializeReport(report));
  }

  return released;
}

// ─── Merge reconciler ──────────────────────────────────────────────────────

/**
 * Fold duplicate primaries left behind by a create-time race. A concurrent
 * insert can slip past `findMergeTarget` (its brief retry window is not a
 * guarantee under load), leaving two open primaries that should have merged.
 * This pass finds open primaries created within the merge window and merges any
 * that still have an older open primary in range, using exactly the same rules
 * as `createReport`. It is idempotent: once a pair is folded, a second pass
 * finds nothing to do.
 *
 * Returns the list of `{ child, primary }` merges performed.
 */
export async function reconcileMerges({ now = new Date(), maxPasses = 5 } = {}) {
  const since = new Date(now.getTime() - MERGE_WINDOW_MS);
  const merges = [];

  for (let pass = 0; pass < maxPasses; pass += 1) {
    const primaries = await Report.find({ mergedInto: null, createdAt: { $gte: since } }).sort({
      createdAt: 1,
      _id: 1,
    });

    let changed = false;
    for (const candidate of primaries) {
      // Re-read: an earlier merge in this pass may have folded it in already.
      const child = await Report.findById(candidate._id);
      if (!child || child.mergedInto) continue;

      const target = await findMergeTarget(child, child.reportedBy);
      if (!target) continue;

      const primary = await resolveRootPrimary(target);
      if (!primary || String(primary._id) === String(child._id)) continue;

      await mergeInto(primary, child);
      const updatedPrimary = await Report.findById(primary._id);
      emitToRooms(
        [...reportRooms(updatedPrimary), ROOMS.user(String(updatedPrimary.reportedBy))],
        EVENTS.REPORT_STATUS_UPDATED,
        serializeReport(updatedPrimary, { mergedFrom: child._id }),
      );
      merges.push({ child: String(child._id), primary: String(primary._id) });
      changed = true;
    }

    if (!changed) break;
  }

  return merges;
}

export { findMergeTarget };
