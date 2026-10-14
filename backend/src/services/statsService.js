import { Report } from '../models/Report.js';
import { NEED_LABELS } from '../config/constants.js';
import { env } from '../config/env.js';

// ~1.1 km grid at the equator. Report locations are bucketed by flooring.
const CELL_SCALE = 100;

function cellKeyExpr(coordIndex) {
  return {
    $floor: {
      $multiply: [{ $arrayElemAt: ['$location.coordinates', coordIndex] }, CELL_SCALE],
    },
  };
}

/**
 * Aggregate pending reports into rounded lat/lng cells with counts, and attach
 * the number of stale claims (claims older than STALE_CLAIM_HOURS) per cell.
 */
export async function getCoverageGaps() {
  const staleCutoff = new Date(Date.now() - env.staleClaimHours * 3600 * 1000);

  const pendingCells = await Report.aggregate([
    { $match: { status: 'pending' } },
    {
      $group: {
        _id: { lat: cellKeyExpr(1), lng: cellKeyExpr(0) },
        count: { $sum: 1 },
        lat: { $avg: { $arrayElemAt: ['$location.coordinates', 1] } },
        lng: { $avg: { $arrayElemAt: ['$location.coordinates', 0] } },
        needTypes: { $addToSet: '$needType' },
      },
    },
  ]);

  const staleCells = await Report.aggregate([
    { $match: { status: 'claimed', claimedAt: { $lt: staleCutoff } } },
    {
      $group: {
        _id: { lat: cellKeyExpr(1), lng: cellKeyExpr(0) },
        staleClaims: { $sum: 1 },
      },
    },
  ]);

  const staleMap = new Map(staleCells.map((c) => [`${c._id.lat}:${c._id.lng}`, c.staleClaims]));

  return pendingCells
    .map((c) => {
      const id = `${c._id.lat}:${c._id.lng}`;
      return {
        id,
        lat: Number(c.lat.toFixed(6)),
        lng: Number(c.lng.toFixed(6)),
        count: c.count,
        // Rough footprint of the cluster, in metres.
        radius: Math.round(300 + Math.min(c.count, 20) * 60),
        needTypes: c.needTypes.map((t) => NEED_LABELS[t] || t),
        needTypesRaw: c.needTypes,
        staleClaims: staleMap.get(id) || 0,
      };
    })
    .sort((a, b) => b.count - a.count);
}

/** Cluster duplicate reports around their canonical (original) report. */
export async function getDuplicateClusters() {
  const clusters = await Report.aggregate([
    { $match: { duplicateOf: { $ne: null } } },
    {
      $group: {
        _id: '$duplicateOf',
        count: { $sum: 1 },
        needTypes: { $addToSet: '$needType' },
      },
    },
    { $sort: { count: -1 } },
    { $limit: 100 },
    {
      $lookup: {
        from: 'reports',
        localField: '_id',
        foreignField: '_id',
        as: 'canonical',
      },
    },
    { $unwind: '$canonical' },
  ]);

  return clusters.map((c) => {
    const coords = c.canonical.location?.coordinates || [];
    const needTypes = c.needTypes.map((t) => NEED_LABELS[t] || t);
    return {
      id: String(c._id),
      lat: coords[1],
      lng: coords[0],
      count: c.count,
      radius: Math.round(150 + Math.min(c.count, 20) * 40),
      needTypes,
      needTypesRaw: c.needTypes,
      staleClaims: 0,
      canonical: {
        id: String(c.canonical._id),
        needType: NEED_LABELS[c.canonical.needType] || c.canonical.needType,
        status: c.canonical.status,
        description: c.canonical.description,
        createdAt: c.canonical.createdAt,
      },
    };
  });
}

/** Aggregate counters for the dashboard. */
export async function getOverview() {
  const byStatus = await Report.aggregate([
    { $group: { _id: '$status', count: { $sum: 1 } } },
  ]);
  const counts = Object.fromEntries(byStatus.map((s) => [s._id, s.count]));
  const totalReports = byStatus.reduce((sum, s) => sum + s.count, 0);

  // Average time from creation to resolution for settled reports.
  const avgAgg = await Report.aggregate([
    { $match: { resolvedAt: { $ne: null } } },
    {
      $project: {
        minutes: { $divide: [{ $subtract: ['$resolvedAt', '$createdAt'] }, 60000] },
      },
    },
    { $group: { _id: null, avg: { $avg: '$minutes' } } },
  ]);
  const avgResponseMin = avgAgg[0] ? Math.round(avgAgg[0].avg) : 0;

  const gaps = await getCoverageGaps();

  return {
    totalReports,
    pending: counts.pending || 0,
    claimed: (counts.claimed || 0) + (counts.in_progress || 0),
    resolved: counts.resolved || 0,
    cannotFulfill: counts.cannot_fulfill || 0,
    avgResponseMin,
    coverageGaps: gaps.length,
  };
}
