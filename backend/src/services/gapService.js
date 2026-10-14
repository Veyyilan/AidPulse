import { Report } from '../models/Report.js';
import { env } from '../config/env.js';
import { emitToRooms } from '../realtime/index.js';
import { gapCellKey } from '../utils/geo.js';
import { GAP_CELL_DEGREES, ROOMS, EVENTS } from '../config/constants.js';

// Last-seen count per qualifying cell. Used to emit gap:alert only when a
// cell's state actually changes.
const trackedState = new Map();

const SCALE = 1 / GAP_CELL_DEGREES; // 0.01 degrees -> factor 100

/**
 * Aggregate pending needs older than GAP_THRESHOLD_MINUTES into 0.01-degree
 * grid cells with counts. Only primary reports (mergedInto null) are counted so
 * merged duplicates are not double-counted.
 */
export async function computeGapCells({ thresholdMinutes = env.gapThresholdMinutes, now = new Date() } = {}) {
  const cutoff = new Date(now.getTime() - thresholdMinutes * 60 * 1000);

  const cells = await Report.aggregate([
    { $match: { mergedInto: null, createdAt: { $lte: cutoff } } },
    { $unwind: '$needs' },
    { $match: { 'needs.status': 'pending' } },
    {
      $group: {
        _id: {
          lat: { $floor: { $multiply: [{ $arrayElemAt: ['$location.coordinates', 1] }, SCALE] } },
          lng: { $floor: { $multiply: [{ $arrayElemAt: ['$location.coordinates', 0] }, SCALE] } },
        },
        count: { $sum: 1 },
        needTypes: { $addToSet: '$needs.type' },
        lat: { $avg: { $arrayElemAt: ['$location.coordinates', 1] } },
        lng: { $avg: { $arrayElemAt: ['$location.coordinates', 0] } },
      },
    },
    { $sort: { count: -1 } },
  ]);

  return cells.map((c) => ({
    cellKey: gapCellKey(c._id.lat, c._id.lng),
    latCell: c._id.lat,
    lngCell: c._id.lng,
    lat: Number(c.lat.toFixed(6)),
    lng: Number(c.lng.toFixed(6)),
    cellDegrees: GAP_CELL_DEGREES,
    count: c.count,
    needTypes: c.needTypes,
  }));
}

/** Clear the in-memory alert state (used by tests). */
export function resetGapState() {
  trackedState.clear();
}

/**
 * Single gap scanner. Recomputes qualifying cells and emits gap:alert to the
 * government room ONLY when a cell's count actually changes since the last run.
 *
 * A cell is tracked while it qualifies (count >= threshold) and kept tracked
 * afterwards while it still has any pending needs, so a claim/resolution that
 * reduces a cell — including all the way to zero — produces exactly one more
 * alert. Cells that were never above the threshold are never announced.
 *
 * NOTE: `trackedState` is in-memory per process, so the dedupe state resets on
 * server restart (a restart re-announces currently-qualifying cells once). This
 * is acceptable per spec.
 */
export async function scanGaps({ threshold = env.gapCellThreshold, now = new Date() } = {}) {
  const cells = await computeGapCells({ now });
  const byKey = new Map(cells.map((c) => [c.cellKey, c]));

  // Cells to keep tracking: qualifies now, OR was already tracked and still has
  // pending activity (so we can observe it dropping to zero later).
  const nextTracked = new Map();
  for (const cell of cells) {
    if (cell.count >= threshold || trackedState.has(cell.cellKey)) {
      nextTracked.set(cell.cellKey, cell.count);
    }
  }

  const changed = [];
  const keys = new Set([...trackedState.keys(), ...nextTracked.keys()]);
  for (const key of keys) {
    const prevCount = trackedState.get(key) ?? 0;
    const cell = byKey.get(key);
    const count = cell ? cell.count : 0;
    if (count === prevCount) continue;

    const alert = {
      ...(cell || { cellKey: key }),
      cellKey: key,
      count,
      threshold,
      thresholdMinutes: env.gapThresholdMinutes,
      at: new Date().toISOString(),
    };
    emitToRooms([ROOMS.government], EVENTS.GAP_ALERT, alert);
    changed.push(alert);
  }

  trackedState.clear();
  for (const [key, count] of nextTracked) trackedState.set(key, count);

  return changed;
}
