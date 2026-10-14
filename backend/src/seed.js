/**
 * Seed script — creates demo users and sample reports.
 * Idempotent: users are upserted by email; sample reports are only inserted
 * when the seeded citizen has none yet.
 *
 * Run: npm run seed
 */
import bcrypt from 'bcryptjs';
import { connectDb, disconnectDb } from './config/db.js';
import { User } from './models/User.js';
import { Report } from './models/Report.js';

const BCRYPT_ROUNDS = 12;

const SEED_USERS = [
  {
    name: 'AidPulse Admin',
    email: 'admin@aidpulse.local',
    password: 'Admin123!',
    role: 'admin',
  },
  {
    name: 'Red Cross Coordinator',
    email: 'ngo1@aidpulse.local',
    password: 'Volunteer123!',
    role: 'ngo',
    organizationName: 'Red Cross',
  },
  {
    name: 'MSF Field Lead',
    email: 'ngo2@aidpulse.local',
    password: 'Volunteer123!',
    role: 'ngo',
    organizationName: 'Doctors Without Borders',
  },
  {
    name: 'Emergency Control Officer',
    email: 'gov@aidpulse.local',
    password: 'Control123!',
    role: 'government',
    organizationName: 'State Emergency Management',
  },
  {
    name: 'Amina Citizen',
    email: 'citizen@aidpulse.local',
    password: 'Citizen123!',
    role: 'citizen',
  },
];

// Around Lagos, Nigeria.
const SAMPLE_REPORTS = [
  {
    needType: 'medical',
    description: 'Elderly resident needs insulin — supply cut off for 48 h.',
    lat: 6.455,
    lng: 3.3841,
    accuracyMeters: 12,
  },
  {
    needType: 'water',
    description: 'Borehole broken, 200+ people without clean water.',
    lat: 6.461,
    lng: 3.392,
    accuracyMeters: 8,
  },
  {
    needType: 'shelter',
    description: 'Flood destroyed three homes, families sleeping outside.',
    lat: 6.448,
    lng: 3.377,
    accuracyMeters: 25,
  },
  {
    needType: 'food',
    description: 'No food for 2 days, children at risk.',
    lat: 6.452,
    lng: 3.38,
    accuracyMeters: 5,
  },
];

async function upsertUsers() {
  const map = {};
  for (const u of SEED_USERS) {
    const passwordHash = await bcrypt.hash(u.password, BCRYPT_ROUNDS);
    const user = await User.findOneAndUpdate(
      { email: u.email },
      {
        $set: {
          name: u.name,
          role: u.role,
          organizationName: u.organizationName ?? null,
          isSuspended: false,
        },
        $setOnInsert: { email: u.email, passwordHash, createdAt: new Date() },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    map[u.email] = user;
  }
  return map;
}

async function seedReports(citizen) {
  const existing = await Report.countDocuments({ reportedBy: citizen._id });
  if (existing > 0) {
    console.log(`[seed] citizen already has ${existing} report(s), skipping samples`);
    return 0;
  }

  const docs = SAMPLE_REPORTS.map((r) => ({
    reportedBy: citizen._id,
    needType: r.needType,
    description: r.description,
    location: { type: 'Point', coordinates: [r.lng, r.lat] },
    accuracyMeters: r.accuracyMeters,
    status: 'pending',
    source: 'app',
    createdAt: new Date(),
  }));
  const created = await Report.insertMany(docs);
  return created.length;
}

async function main() {
  if (process.env.NODE_ENV === "production") {
    console.log("[seed] Seed script disabled in production (NODE_ENV=production).");
    console.log("[seed] Set NODE_ENV=development to run seeding.");
    return;
  }
  await connectDb();
  console.log('[seed] connected');

  const users = await upsertUsers();
  console.log(`[seed] upserted ${Object.keys(users).length} user(s)`);

  const reportCount = await seedReports(users['citizen@aidpulse.local']);
  if (reportCount) console.log(`[seed] inserted ${reportCount} sample report(s)`);

  console.log('\n[seed] demo accounts (email / password):');
  for (const u of SEED_USERS) {
    console.log(`  ${u.role.padEnd(10)} ${u.email.padEnd(24)} ${u.password}`);
  }

  await disconnectDb();
  console.log('\n[seed] done.');
}

main().catch(async (err) => {
  console.error('[seed] failed:', err);
  await disconnectDb().catch(() => {});
  process.exit(1);
});

