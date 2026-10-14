import { startStaleClaimJob } from './staleClaims.js';
import { startGapScanner } from './gapScanner.js';

/** Start all background jobs. Safe to call once at server start. */
export function startScheduler() {
  return {
    staleClaims: startStaleClaimJob(),
    gapScanner: startGapScanner(),
  };
}
