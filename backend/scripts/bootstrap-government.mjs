/**
 * bootstrap-government.mjs — one-off script to create or promote a government account.
 *
 * Usage (from backend directory):
 *   node scripts/bootstrap-government.mjs <email> <password> <name> <organizationName>
 *
 * Example:
 *   node scripts/bootstrap-government.mjs gov@tn.gov.in SecureGov123! "TN Disaster Control" "Tamil Nadu Disaster Management Authority"
 */

import { MongoClient } from 'mongodb';
import bcrypt from 'bcryptjs';

const email = process.argv[2];
const password = process.argv[3];
const name = process.argv[4] || 'Government Official';
const organizationName = process.argv[5] || 'State Disaster Management Authority';

if (!email || !password) {
  console.error('Usage: node scripts/bootstrap-government.mjs <email> <password> [name] [organizationName]');
  console.error('Example: node scripts/bootstrap-government.mjs gov@tn.gov.in GovPass123! "Control Officer" "TNDMA"');
  process.exit(1);
}

const uri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/aidpulse';
const client = new MongoClient(uri);

try {
  await client.connect();
  console.log('[bootstrap-government] Connected to MongoDB.');

  const db = client.db();
  const users = db.collection('users');
  const passwordHash = await bcrypt.hash(password, 12);

  const cleanEmail = email.trim().toLowerCase();

  const result = await users.findOneAndUpdate(
    { email: cleanEmail },
    {
      $set: {
        name: name.trim(),
        role: 'government',
        organizationName: organizationName.trim(),
        passwordHash,
        isSuspended: false,
      },
      $setOnInsert: {
        email: cleanEmail,
        createdAt: new Date(),
        phone: null,
      },
    },
    { upsert: true, returnDocument: 'after' }
  );

  console.log('[bootstrap-government] ✓ Government account ready:');
  console.log(`    email        : ${result.email}`);
  console.log(`    name         : ${result.name}`);
  console.log(`    role         : ${result.role}`);
  console.log(`    organization : ${result.organizationName}`);
  console.log('\nUse these credentials to sign in and register authorized NGO accounts.');
} catch (err) {
  console.error('[bootstrap-government] Failed:', err.message);
  process.exit(1);
} finally {
  await client.close();
}
