import { env } from '../config/env.js';
import { scanGaps } from '../services/gapService.js';

let timer = null;

/**
 * Start the single gap scanner. Runs every GAP_SCAN_MINUTES (default 5) and
 * emits gap:alert to the government room only when a cell's state changes.
 */
export function startGapScanner() {
  if (timer) clearInterval(timer);
  const intervalMs = Math.max(1000, env.gapScanMinutes * 60 * 1000);

  timer = setInterval(() => {
    scanGaps()
      .then((changed) => {
        if (changed.length) {
          // eslint-disable-next-line no-console
          console.log(`[gap-scanner] ${changed.length} gap cell(s) changed`);
        }
      })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.warn('[gap-scanner] failed:', err.message);
      });
  }, intervalMs);
  timer.unref?.();

  // eslint-disable-next-line no-console
  console.log(
    `[gap-scanner] every ${env.gapScanMinutes} min (pending > ${env.gapThresholdMinutes} min, cell >= ${env.gapCellThreshold})`,
  );
  return timer;
}

export function stopGapScanner() {
  if (timer) clearInterval(timer);
  timer = null;
}
