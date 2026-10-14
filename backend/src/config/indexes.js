import { Report } from '../models/Report.js';

/**
 * Reconcile the `reports` indexes with the current schema on startup.
 *
 * The first schema version declared a *global* unique index on `clientId`
 * (named `clientId_1`). Idempotency is now scoped per reporting user via the
 * compound `{ reportedBy, clientId }` index, so the legacy global index must be
 * dropped — otherwise MongoDB would keep rejecting a *different* user reusing
 * the same clientId, breaking per-user idempotency.
 *
 * `createIndexes()` (not `syncIndexes()`) is used so we never silently drop an
 * unrelated index in a production database.
 */
export async function syncReportIndexes() {
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

  await Report.createIndexes();
}
