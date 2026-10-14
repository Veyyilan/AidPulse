import { env } from '../config/env.js';
import { sweepStaleClaims, reconcileMerges } from '../services/reportService.js';

let timer = null;

/**
 * Sweep force-releases stale claims, then reconciles duplicate primaries that a
 * create-time race left unmerged. Each step is independent and idempotent, so a
 * failure in one still lets the other run on the next tick.
 */
async function runSweepAndReconcile() {
  try {
    const released = await sweepStaleClaims();
    if (released.length) {
      // eslint-disable-next-line no-console
      console.log(`[sweeper] force-released ${released.length} stale need(s)`);
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[sweeper] sweep failed:', err.message);
  }

  try {
    const merges = await reconcileMerges();
    if (merges.length) {
      // eslint-disable-next-line no-console
      console.log(`[sweeper] reconciled ${merges.length} duplicate primary report(s)`);
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[sweeper] reconcile failed:', err.message);
  }
}

/**
 * Start the stale-claim sweeper. Runs every STALE_SWEEP_MINUTES (default 15),
 * force-releases needs with no update for more than STALE_CLAIM_HOURS
 * (default 4), and reconciles duplicate primaries. Every write is conditional,
 * so repeated runs are harmless.
 */
export function startStaleClaimJob() {
  if (timer) clearInterval(timer);
  const intervalMs = Math.max(1000, env.staleSweepMinutes * 60 * 1000);

  timer = setInterval(() => {
    runSweepAndReconcile().catch((err) => {
      // eslint-disable-next-line no-console
      console.warn('[sweeper] failed:', err.message);
    });
  }, intervalMs);
  timer.unref?.();

  // eslint-disable-next-line no-console
  console.log(
    `[sweeper] every ${env.staleSweepMinutes} min (releases claims idle > ${env.staleClaimHours} h, reconciles merges)`,
  );
  return timer;
}

export function stopStaleClaimJob() {
  if (timer) clearInterval(timer);
  timer = null;
}
