import cron from 'node-cron';
import { Report } from '../models/Report.js';
import { recordAudit } from '../services/auditService.js';
import { emitToRooms } from '../realtime/index.js';
import { serializeReport } from '../utils/serialize.js';
import { OPERATIONAL_ROOMS } from '../config/constants.js';
import { env } from '../config/env.js';

/**
 * Revert claims that have sat without any update for STALE_CLAIM_HOURS back to
 * `pending`, logging a `force_released` audit row and emitting `report:released`.
 * Each revert is itself an atomic conditional update so concurrent sweeps are safe.
 */
export async function runStaleClaimSweep() {
  const cutoff = new Date(Date.now() - env.staleClaimHours * 3600 * 1000);

  const stale = await Report.find({ status: 'claimed', claimedAt: { $lt: cutoff } }).select('_id');

  let released = 0;
  for (const { _id } of stale) {
    const updated = await Report.findOneAndUpdate(
      { _id, status: 'claimed', claimedAt: { $lt: cutoff } },
      { $set: { status: 'pending' }, $unset: { claimedBy: 1, claimedAt: 1 } },
      { new: true },
    );
    if (!updated) continue;

    await recordAudit({ reportId: updated._id, actorId: null, action: 'force_released' });
    emitToRooms(
      [...OPERATIONAL_ROOMS, `user:${updated.reportedBy}`],
      'report:released',
      serializeReport(updated),
    );
    released += 1;
  }

  if (released > 0) {
    // eslint-disable-next-line no-console
    console.log(`[stale-claims] force-released ${released} stale claim(s)`);
  }
  return released;
}

/** Schedule the sweeper every 15 minutes. */
export function startStaleClaimJob() {
  cron.schedule('*/15 * * * *', () => {
    runStaleClaimSweep().catch((err) => {
      // eslint-disable-next-line no-console
      console.error('[stale-claims] sweep failed:', err.message);
    });
  });
}
