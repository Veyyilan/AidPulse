/**
 * bootstrap-government.mjs — manual equivalent of the server-start bootstrap.
 *
 * Creates the single government account from GOV_EMAIL / GOV_PASSWORD (or CLI
 * args) ONLY when no government user exists. It never overwrites an existing
 * government account and never logs the password.
 *
 * Usage:
 *   node scripts/bootstrap-government.mjs
 *   node scripts/bootstrap-government.mjs gov@tn.gov.in 'GovPass123!'
 *   GOV_EMAIL=... GOV_PASSWORD=... node scripts/bootstrap-government.mjs
 */
import bcrypt from 'bcryptjs';
import { connectDb, disconnectDb } from '../src/config/db.js';
import { User } from '../src/models/User.js';

const email = (process.argv[2] || process.env.GOV_EMAIL || '').trim().toLowerCase();
const password = process.argv[3] || process.env.GOV_PASSWORD || '';
const name = process.argv[4] || 'Government Control';
const organizationName = process.argv[5] || 'State Emergency Management';

async function main() {
  if (!email || !password) {
    console.error(
      'Usage: node scripts/bootstrap-government.mjs [email] [password] [name] [organizationName]\n'
        + '       (email/password may also come from GOV_EMAIL / GOV_PASSWORD)',
    );
    process.exit(1);
  }

  await connectDb();

  const existing = await User.findOne({ role: 'government' });
  if (existing) {
    console.log('[bootstrap-government] A government account already exists; nothing to do.');
    console.log(`    email : ${existing.email}`);
    console.log(`    name  : ${existing.name}`);
    console.log('  (Existing government accounts are never overwritten.)');
    await disconnectDb();
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const gov = await User.create({
    name,
    email,
    passwordHash,
    role: 'government',
    organizationName,
    mustChangePassword: true,
    identityVerified: false,
  });

  console.log('[bootstrap-government] ✓ Government account ready:');
  console.log(`    email        : ${gov.email}`);
  console.log(`    name         : ${gov.name}`);
  console.log(`    organization : ${gov.organizationName}`);
  console.log('    mustChangePassword: true');
  console.log('\nUse these credentials to sign in and register authorized NGO accounts.');

  await disconnectDb();
}

main()
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error('[bootstrap-government] failed:', err.message);
    await disconnectDb().catch(() => {});
    process.exit(1);
  });
