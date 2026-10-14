import { User } from '../models/User.js';
import { Report } from '../models/Report.js';
import { ClaimAudit } from '../models/ClaimAudit.js';

/**
 * Reconcile indexes for every model on startup.
 *
 * `createIndexes()` (not `syncIndexes()`) is used on the live path so we never
 * silently drop an unrelated index in a production database. The dev-only
 * `scripts/dev-reset.mjs` uses `syncIndexes()` for a true clean slate.
 */
export async function syncReportIndexes() {
  // The legacy schema declared a global unique index on clientId. Idempotency
  // is scoped per reporting user now, so drop the old index if present.
  try {
    const existing = await Report.collection.indexes();
    if (existing.some((ix) => ix.name === 'clientId_1')) {
      await Report.collection.dropIndex('clientId_1');
      // eslint-disable-next-line no-console
      console.log('[db] dropped legacy index clientId_1 (idempotency is now per user)');
    }
  } catch (err) {
    // A collection that does not exist yet is expected on a fresh database.
    if (err.codeName !== 'NamespaceNotFound' && err.code !== 26) {
      // eslint-disable-next-line no-console
      console.warn('[db] index reconciliation note:', err.message);
    }
  }

  await Promise.all([User.createIndexes(), Report.createIndexes(), ClaimAudit.createIndexes()]);
}
