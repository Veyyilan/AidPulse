/**
 * demo-seed.mjs — MANUAL demo data only.
 *
 * This is the ONLY place sample users/reports are created, it is never invoked
 * automatically, and it refuses to run when NODE_ENV=production.
 *
 * Creates:
 *   - a demo citizen (phone +91 9000000001)
 *   - two demo NGOs (medical, food) with capabilities
 *   - a few sample reports around Chennai, Tamil Nadu
 *
 * Government is NOT seeded here — it comes from the env-based bootstrap
 * (server start or scripts/bootstrap-government.mjs), or you can create one
 * manually with that script.
 *
 * Run:  npm run seed
 */
import bcrypt from 'bcryptjs';
import { connectDb, disconnectDb } from '../src/config/db.js';
import { env } from '../src/config/env.js';
import { User } from '../src/models/User.js';
import { Report } from '../src/models/Report.js';

const BCRYPT_ROUNDS = env.bcryptRounds;

const DEMO_CITIZEN = {
  name: 'Demo Citizen',
  phone: '+919000000001',
  password: 'Citizen123!',
};

const DEMO_NGOS = [
  {
    name: 'Meera Medical Lead',
    email: 'medical.ngo@aidpulse.local',
    password: 'Volunteer123!',
    organizationName: 'Chennai Medical Relief',
    capabilities: ['medical'],
  },
  {
    name: 'Arun Food Lead',
    email: 'food.ngo@aidpulse.local',
    password: 'Volunteer123!',
    organizationName: 'Coastal Food Trust',
    capabilities: ['food'],
  },
];

// Around Chennai, Tamil Nadu.
const SAMPLE_REPORTS = [
  {
    needs: ['medical'],
    lat: 13.0827,
    lng: 80.2707,
    accuracyMeters: 12,
  },
  {
    needs: ['food', 'shelter'],
    lat: 13.0900,
    lng: 80.2800,
    accuracyMeters: 8,
  },
  {
    needs: ['rescue'],
    lat: 13.0700,
    lng: 80.2600,
    accuracyMeters: 25,
  },
];

async function upsertCivilianLike() {
  let citizen = await User.findOne({ phone: DEMO_CITIZEN.phone });
  if (!citizen) {
    citizen = await User.create({
      name: DEMO_CITIZEN.name,
      phone: DEMO_CITIZEN.phone,
      passwordHash: await bcrypt.hash(DEMO_CITIZEN.password, BCRYPT_ROUNDS),
      role: 'citizen',
      consentAt: new Date(),
      identityVerified: false,
    });
  }

  for (const ngo of DEMO_NGOS) {
    const existing = await User.findOne({ email: ngo.email });
    if (existing) continue;
    await User.create({
      name: ngo.name,
      email: ngo.email,
      passwordHash: await bcrypt.hash(ngo.password, BCRYPT_ROUNDS),
      role: 'ngo',
      capabilities: ngo.capabilities,
      organizationName: ngo.organizationName,
      identityVerified: false,
      mustChangePassword: false,
    });
  }

  return citizen;
}

async function seedReports(citizen) {
  const existing = await Report.countDocuments({ reportedBy: citizen._id });
  if (existing > 0) {
    console.log(`[seed] citizen already has ${existing} report(s), skipping samples`);
    return 0;
  }

  const docs = SAMPLE_REPORTS.map((r) => ({
    reportedBy: citizen._id,
    location: { type: 'Point', coordinates: [r.lng, r.lat] },
    accuracyMeters: r.accuracyMeters,
    needs: r.needs.map((type) => ({ type, status: 'pending' })),
    mergedInto: null,
    reporterCount: 1,
    flags: [],
    createdAt: new Date(),
  }));

  const created = await Report.insertMany(docs);
  return created.length;
}

async function main() {
  if (process.env.NODE_ENV === 'production') {
    console.error('[seed] Refusing to run with NODE_ENV=production.');
    process.exit(1);
  }

  await connectDb();
  console.log('[seed] connected');

  const citizen = await upsertCivilianLike();
  const reportCount = await seedReports(citizen);
  if (reportCount) console.log(`[seed] inserted ${reportCount} sample report(s)`);

  console.log('\n[seed] demo accounts (login identifier / password):');
  console.log(`  citizen    phone ${DEMO_CITIZEN.phone}   ${DEMO_CITIZEN.password}`);
  for (const ngo of DEMO_NGOS) {
    console.log(`  ngo        email ${ngo.email}   ${ngo.password}`);
  }

  await disconnectDb();
  console.log('\n[seed] done.');
}

main().catch(async (err) => {
  console.error('[seed] failed:', err);
  await disconnectDb().catch(() => {});
  process.exit(1);
});
