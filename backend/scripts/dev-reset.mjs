/**
 * dev-reset.mjs — clean slate for development.
 *
 * Drops the users/reports/claimaudits collections and rebuilds every model's
 * indexes with `syncIndexes()` (which also removes indexes no longer declared
 * by the schema). Refuses to run when NODE_ENV=production.
 *
 * Usage (from the backend directory):
 *   npm run reset:dev
 *   MONGO_URI="mongodb://127.0.0.1:27017/aidpulse" node scripts/dev-reset.mjs
 */
import { connectDb, disconnectDb } from '../src/config/db.js';
import { User } from '../src/models/User.js';
import { Report } from '../src/models/Report.js';
import { ClaimAudit } from '../src/models/ClaimAudit.js';

const MODELS = [User, Report, ClaimAudit];

async function main() {
  if (process.env.NODE_ENV === 'production') {
    console.error('[dev-reset] Refusing to run with NODE_ENV=production.');
    process.exit(1);
  }

  await connectDb();
  console.log('[dev-reset] connected');

  for (const model of MODELS) {
    const name = model.collection.collectionName;
    try {
      await model.collection.drop();
      console.log(`[dev-reset] dropped collection: ${name}`);
    } catch (err) {
      // Collection may not exist yet on a fresh database.
      if (err.codeName === 'NamespaceNotFound' || err.code === 26) {
        console.log(`[dev-reset] collection not present, skipping: ${name}`);
      } else {
        throw err;
      }
    }
  }

  for (const model of MODELS) {
    const dropped = await model.syncIndexes();
    const name = model.collection.collectionName;
    if (dropped && dropped.length) {
      console.log(`[dev-reset] ${name}: dropped stale indexes -> ${dropped.join(', ')}`);
    } else {
      console.log(`[dev-reset] ${name}: indexes synced`);
    }
  }

  console.log('\n[dev-reset] done. Database is empty with fresh indexes.');
  await disconnectDb();
}

main()
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error('[dev-reset] failed:', err.message);
    await disconnectDb().catch(() => {});
    process.exit(1);
  });
