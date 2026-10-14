import { Report } from '../models/Report.js';

/**
 * Merge clusters: each primary report together with the reports merged into
 * it. Surfaced to government for review (including spam flags).
 */
export async function getMergeClusters({ limit = 200 } = {}) {
  const clusters = await Report.aggregate([
    { $match: { mergedInto: { $ne: null } } },
    { $group: { _id: '$mergedInto', mergedCount: { $sum: 1 } } },
    { $sort: { mergedCount: -1 } },
    { $limit: Math.min(Math.max(Number(limit) || 200, 1), 500) },
    {
      $lookup: {
        from: 'reports',
        localField: '_id',
        foreignField: '_id',
        as: 'primary',
      },
    },
    { $unwind: '$primary' },
  ]);

  return clusters.map((c) => {
    const coords = c.primary.location?.coordinates || [];
    return {
      primaryId: String(c._id),
      lat: coords[1] ?? null,
      lng: coords[0] ?? null,
      mergedCount: c.mergedCount,
      reporterCount: c.primary.reporterCount,
      needTypes: (c.primary.needs || []).map((n) => n.type),
      needs: (c.primary.needs || []).map((n) => ({ type: n.type, status: n.status })),
      flags: c.primary.flags || [],
      createdAt: c.primary.createdAt,
    };
  });
}
