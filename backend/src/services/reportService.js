import { Report } from '../models/Report.js';
import { User } from '../models/User.js';
import { ApiError } from '../utils/ApiError.js';
import { recordAudit } from './auditService.js';
import { toGeoPoint } from '../utils/geo.js';
import { serializeReport } from '../utils/serialize.js';
import { emitToRooms } from '../realtime/index.js';
import {
  DUPLICATE_RADIUS_M,
  DUPLICATE_WINDOW_MS,
  OPEN_STATUSES,
  OPERATIONAL_ROOMS,
} from '../config/constants.js';

const SYSTEM_SMS_EMAIL = 'sms-gateway@aidpulse.local';

export async function createReport({
  userId,
  needType,
  description,
  lat,
  lng,
  accuracyMeters = null,
  source = 'app',
  clientId = undefined,
}) {
  const now = new Date();
  const since = new Date(now.getTime() - DUPLICATE_WINDOW_MS);

  let original = null;
  try {
    original = await Report.findOne({
      needType,
      status: { $in: OPEN_STATUSES },
      createdAt: { $gte: since },
      location: {
        $near: {
          $geometry: toGeoPoint(lat, lng),
          $maxDistance: DUPLICATE_RADIUS_M,
        },
      },
    });
  } catch {
    original = null;
  }

  const report = await Report.create({
    reportedBy: userId,
    needType,
    description,
    location: toGeoPoint(lat, lng),
    accuracyMeters,
    status: 'pending',
    source,
    duplicateOf: original ? original._id : null,
    duplicateCount: 0,
    createdAt: now,
    ...(clientId ? { clientId } : {}),
  });

  if (original) {
    original.duplicateCount = (original.duplicateCount || 0) + 1;
    await original.save();
    report.duplicateCount = original.duplicateCount;
    await report.save();
  }

  return report;
}

export async function getReportById(id) {
  const report = await Report.findById(id);
  if (!report) throw ApiError.notFound("Report not found");
  return report;
}

/**
 * Idempotency lookup. Scoped to the reporting user so a clientId can only ever
 * resolve to a report that user created — another user reusing the same
 * clientId must never receive this report back.
 */
export async function findReportByClientId(clientId, userId) {
  if (!clientId || !userId) return null;
  return Report.findOne({ clientId, reportedBy: userId });
}

export async function claimReport({ reportId, userId }) {
  const updated = await Report.findOneAndUpdate(
    { _id: reportId, status: 'pending' },
    { $set: { status: 'claimed', claimedBy: userId, claimedAt: new Date() } },
    { new: true },
  );

  if (!updated) return null;

  await recordAudit({ reportId: updated._id, actorId: userId, action: "claimed" });

  emitToRooms(
    [...OPERATIONAL_ROOMS, `user:${updated.reportedBy}`],
    "report:claimed",
    serializeReport(updated),
  );

  return updated;
}

export async function releaseReport({ reportId, userId, force = false }) {
  const filter = { _id: reportId, status: "claimed" };
  if (!force) filter.claimedBy = userId;

  const updated = await Report.findOneAndUpdate(
    filter,
    { $set: { status: "pending" }, $unset: { claimedBy: 1, claimedAt: 1 } },
    { new: true },
  );

  if (!updated) return null;

  await recordAudit({
    reportId: updated._id,
    actorId: userId,
    action: force ? "force_released" : "released",
  });

  emitToRooms(
    [...OPERATIONAL_ROOMS, `user:${updated.reportedBy}`],
    "report:released",
    serializeReport(updated),
  );

  return updated;
}

export async function updateReportStatus({ reportId, status, userId }) {
  const patch = { status };
  if (status === "resolved" || status === "cannot_fulfill") {
    patch.resolvedAt = new Date();
  }

  const updated = await Report.findByIdAndUpdate(reportId, { $set: patch }, { new: true });
  if (!updated) return null;

  if (status === "resolved" || status === "cannot_fulfill") {
    await recordAudit({ reportId: updated._id, actorId: userId, action: "resolved" });
  }

  emitToRooms(
    [...OPERATIONAL_ROOMS, `user:${updated.reportedBy}`],
    "report:status_updated",
    serializeReport(updated),
  );

  return updated;
}

export async function listReports({ status, needType, limit = 200 } = {}) {
  const filter = {};
  if (status) filter.status = status;
  if (needType) filter.needType = needType;
  return Report.find(filter).sort({ createdAt: -1 }).limit(Number(limit));
}

export async function listMine(userId) {
  return Report.find({ reportedBy: userId }).sort({ createdAt: -1 });
}

export async function listNearby({ lat, lng, maxDistanceM = 50000, limit = 200 }) {
  const results = await Report.aggregate([
    {
      $geoNear: {
        near: toGeoPoint(lat, lng),
        distanceField: "distanceMeters",
        maxDistance: Number(maxDistanceM),
        spherical: true,
        query: { status: { $in: OPEN_STATUSES.concat(["resolved", "cannot_fulfill"]) } },
      },
    },
    { $sort: { distanceMeters: 1 } },
    { $limit: Number(limit) },
  ]);

  return results.map((doc) => ({
    doc,
    distanceKm: (doc.distanceMeters || 0) / 1000,
  }));
}

export async function detectAndEmitGap(lat, lng, { radiusM = 1000, threshold } = {}) {
  const cells = await Report.aggregate([
    {
      $geoNear: {
        near: toGeoPoint(lat, lng),
        distanceField: "distanceMeters",
        maxDistance: radiusM,
        spherical: true,
        query: { status: "pending" },
      },
    },
    {
      $group: {
        _id: null,
        count: { $sum: 1 },
        needTypes: { $addToSet: "$needType" },
      },
    },
  ]);

  const cell = cells[0];
  if (!cell) return null;

  const limit = threshold ?? 3;
  if (cell.count < limit) return null;

  const alert = {
    id: `gap-${Math.round(lat * 1000)}-${Math.round(lng * 1000)}`,
    lat,
    lng,
    count: cell.count,
    radius: radiusM,
    needTypes: cell.needTypes,
    needTypesLabel: cell.needTypes,
    staleClaims: 0,
  };

  emitToRooms(["control-room", "admin-room"], "gap:alert", alert);
  return alert;
}

export async function resolveSmsUserId() {
  const existing = await User.findOne({ email: SYSTEM_SMS_EMAIL });
  if (existing) return existing._id;

  const bcrypt = (await import("bcryptjs")).default;
  const created = await User.create({
    name: "SMS Gateway",
    email: SYSTEM_SMS_EMAIL,
    role: "citizen",
    organizationName: "AidPulse SMS",
    passwordHash: await bcrypt.hash(Math.random().toString(36).slice(2) + Date.now(), 12),
  });
  return created._id;
}