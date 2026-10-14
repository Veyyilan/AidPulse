/**
 * promote-admin.mjs — one-off script to promote a user to admin.
 *
 * Usage (run from the backend/ directory):
 *   MONGO_URI="mongodb+srv://..." node scripts/promote-admin.mjs user@example.com
 *
 * The user must already exist (register normally on the live site first).
 * This script works in any NODE_ENV — it is NOT gated by production checks.
 */

import { MongoClient } from 'mongodb';

const email = process.argv[2];
if (!email) {
  console.error('Usage: MONGO_URI="..." node scripts/promote-admin.mjs <email>');
  process.exit(1);
}

const uri = process.env.MONGO_URI;
if (!uri) {
  console.error('Error: MONGO_URI environment variable is required.');
  process.exit(1);
}

const client = new MongoClient(uri);

try {
  await client.connect();
  console.log('[promote-admin] Connected to MongoDB.');

  const db = client.db(); // uses the database name from the URI
  const users = db.collection('users');

  const result = await users.findOneAndUpdate(
    { email: email.trim().toLowerCase() },
    { $set: { role: 'admin' } },
    { returnDocument: 'after' }
  );

  if (!result) {
    console.error(`[promote-admin] No user found with email: ${email}`);
    console.error('  → Register this account on the live site first, then re-run.');
    process.exit(1);
  }

  console.log(`[promote-admin] ✓ Promoted user to admin:`);
  console.log(`    email : ${result.email}`);
  console.log(`    name  : ${result.name}`);
  console.log(`    role  : ${result.role}`);
  console.log('\n  → Log out and back in on the site so the new JWT carries the admin role.');
} catch (err) {
  console.error('[promote-admin] Failed:', err.message);
  process.exit(1);
} finally {
  await client.close();
}
