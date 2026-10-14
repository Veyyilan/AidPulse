/**
 * check-flow.mjs — AidPulse end-to-end verification, grown phase by phase.
 *
 * Modes:
 *   node scripts/check-flow.mjs --core   service/DB-level tests only
 *   node scripts/check-flow.mjs          full suite (spawns Mongo + API if needed)
 *   node scripts/check-flow.mjs --atlas  full suite against a throwaway MongoDB
 *                                        Atlas database (requires ATLAS_TEST_URI)
 *
 * Env:
 *   MONGO_URI       target database. When unset, an in-memory Mongo is started.
 *   BASE_URL        running API base (e.g. http://localhost:4000/api). When unset
 *                   and not --core, an API server is spawned against the same DB.
 *   ATLAS_TEST_URI  cluster URI WITHOUT a database name (--atlas only). The script
 *                   appends `aidpulse_test_<timestamp>` and drops it afterwards.
 *   JWT_SECRET      must match the spawned API server when signing test tokens.
 *
 * Exit code is non-zero if any check fails.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import mongoose from 'mongoose';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const CORE_ONLY = process.argv.includes('--core');
const IS_ATLAS = process.argv.includes('--atlas');

const TEST_GOV_EMAIL = 'gov.flow@aidpulse.test';
const TEST_GOV_PASSWORD = 'GovFlow123!';
const TEST_GOV_STABLE_PASSWORD = 'GovStable123!';
const TEST_JWT_SECRET = process.env.JWT_SECRET || 'flow-test-secret-key-32-characters-long';

// Generous network timeouts on Atlas; snappy locally.
const API_TIMEOUT_MS = IS_ATLAS ? 60000 : 15000;
const MONGO_SELECTION_TIMEOUT_MS = IS_ATLAS ? 30000 : 10000;
const HEALTH_TIMEOUT_MS = IS_ATLAS ? 60000 : 20000;

let mongoUri = process.env.MONGO_URI || null;
let baseUrl = process.env.BASE_URL || null;
let mongoServer = null;
let serverChild = null;
let atlasDb = null;

// ─── Atlas database-name handling ──────────────────────────────────────────
/** Extract the database name (path segment) from a MongoDB connection URI. */
function databaseNameOf(uri) {
  const noQuery = String(uri || '').split('?')[0];
  const afterScheme = noQuery.replace(/^mongodb(\+srv)?:\/\//i, '');
  const slash = afterScheme.indexOf('/');
  const pathPart = slash >= 0 ? afterScheme.slice(slash + 1) : '';
  return pathPart ? decodeURIComponent(pathPart) : '';
}

/** Insert/replace the database name in a MongoDB URI, keeping the query string. */
function withDatabaseName(uri, dbName) {
  const [beforeQuery, query] = String(uri).split('?');
  const base = beforeQuery.replace(/\/+$/, '');
  return `${base}/${dbName}${query ? `?${query}` : ''}`;
}

/**
 * Guard rail: never reset or drop anything whose database name does not start
 * with `aidpulse_test_`. Returns the database name.
 */
function assertSafeTestDatabase(uri) {
  const name = databaseNameOf(uri);
  if (!name || !name.startsWith('aidpulse_test_')) {
    throw new Error(
      `[check-flow] refusing to use database "${name || '(none)'}" — `
        + 'Atlas test databases must start with "aidpulse_test_".',
    );
  }
  return name;
}

let passed = 0;
let failed = 0;
const failures = [];

// Tokens/ids shared across phases (government token from the bootstrap login).
const shared = {};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function check(name, condition, extra) {
  if (condition) {
    passed += 1;
    console.log(`  \u2713 ${name}`);
  } else {
    failed += 1;
    failures.push(name);
    console.error(`  \u2717 ${name}${extra !== undefined ? ` -> ${JSON.stringify(extra)}` : ''}`);
  }
}

function section(title) {
  console.log(`\n${title}`);
}

// ─── HTTP helpers ──────────────────────────────────────────────────────────
async function api(method, urlPath, { token, body, timeoutMs } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || API_TIMEOUT_MS);
  try {
    const res = await fetch(`${baseUrl}${urlPath}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    let json = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    return { status: res.status, body: json };
  } finally {
    clearTimeout(timer);
  }
}

function decodeJwt(token) {
  const part = String(token || '').split('.')[1] || '';
  const padded = part.replace(/-/g, '+').replace(/_/g, '/');
  return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
}

/** Hide credentials when a connection URI is printed. */
function redactUri(uri) {
  return String(uri || '').replace(/(mongodb(?:\+srv)?:\/\/)[^@/]+@/i, '$1***:***@');
}

/** Sign an already-expired token with the same secret the API server uses. */
async function expiredToken(userId) {
  const jwt = (await import('jsonwebtoken')).default;
  return jwt.sign({ sub: String(userId), role: 'citizen' }, TEST_JWT_SECRET, { expiresIn: '-1h' });
}

// ─── Lifecycle ─────────────────────────────────────────────────────────────
async function setupMongo() {
  if (IS_ATLAS) {
    const clusterUri = process.env.ATLAS_TEST_URI;
    if (!clusterUri) {
      throw new Error('[check-flow] --atlas requires ATLAS_TEST_URI (cluster URI without a database name).');
    }
    const preexisting = databaseNameOf(clusterUri);
    if (preexisting) {
      throw new Error(
        `[check-flow] ATLAS_TEST_URI must NOT include a database name (found "${preexisting}").`,
      );
    }
    atlasDb = `aidpulse_test_${Date.now()}`;
    mongoUri = withDatabaseName(clusterUri, atlasDb);
    // The name is generated here, but verify it anyway — this is the guard rail
    // that protects every reset/drop in this script.
    assertSafeTestDatabase(mongoUri);
    console.log(`[check-flow] atlas target database: ${atlasDb}`);
    return;
  }

  if (!mongoUri) {
    const { MongoMemoryServer } = await import('mongodb-memory-server');
    mongoServer = await MongoMemoryServer.create({ instance: { dbName: 'aidpulse_check' } });
    mongoUri = mongoServer.getUri('aidpulse_check');
  }
}

async function startServer() {
  if (CORE_ONLY || baseUrl) return;
  const port = 4100 + Math.floor(Math.random() * 300);
  const env = {
    ...process.env,
    NODE_ENV: 'development',
    MONGO_URI: mongoUri,
    PORT: String(port),
    JWT_SECRET: TEST_JWT_SECRET,
    CLIENT_ORIGIN: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
    GOV_EMAIL: TEST_GOV_EMAIL,
    GOV_PASSWORD: TEST_GOV_PASSWORD,
    IDENTITY_MODE: 'basic',
    // Long enough that background jobs never interleave with the tests (they
    // would otherwise emit gap:alert / force-release mid-run).
    GAP_SCAN_MINUTES: '600',
    STALE_SWEEP_MINUTES: '600',
    // Generous driver timeout when talking to Atlas.
    MONGO_SERVER_SELECTION_TIMEOUT_MS: String(MONGO_SELECTION_TIMEOUT_MS),
  };
  serverChild = spawn(process.execPath, ['src/index.js'], { cwd: ROOT, env, stdio: 'inherit' });
  baseUrl = `http://localhost:${port}/api`;
  await waitForHealth(HEALTH_TIMEOUT_MS);
}

async function waitForHealth(timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${baseUrl}/health`);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('server did not come up in time');
}

/** Drop the throwaway Atlas database. Refuses unless the name is safe. */
async function dropAtlasDatabase() {
  if (!IS_ATLAS || !mongoUri) return;
  try {
    const name = assertSafeTestDatabase(mongoUri);
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.dropDatabase();
    }
    console.log(`[check-flow] dropped atlas database: ${name}`);
  } catch (err) {
    console.error('[check-flow] failed to drop atlas database:', err.message);
  }
}

async function teardown() {
  if (serverChild) {
    try {
      serverChild.kill();
    } catch {
      /* already gone */
    }
  }
  // Atlas: always drop the generated database, even on failure.
  await dropAtlasDatabase();
  await mongoose.disconnect().catch(() => {});
  if (mongoServer) await mongoServer.stop().catch(() => {});
}

// ─── Phase 1: models, indexes ──────────────────────────────────────────────
async function phase1Models() {
  section('phase 1 — models and indexes');
  const { default: mongoose } = await import('mongoose');
  const { User } = await import('../src/models/User.js');
  const { Report } = await import('../src/models/Report.js');
  const { ClaimAudit } = await import('../src/models/ClaimAudit.js');
  const { syncReportIndexes } = await import('../src/config/indexes.js');

  await Promise.all([
    User.deleteMany({}),
    Report.deleteMany({}),
    ClaimAudit.collection.deleteMany({}),
  ]);
  await syncReportIndexes();

  const reportIndexes = await Report.collection.indexes();
  check(
    'reports has a 2dsphere index on location',
    reportIndexes.some((ix) => ix.key && ix.key.location === '2dsphere'),
    reportIndexes.map((i) => i.name),
  );
  check(
    'reports has unique {reportedBy, clientId} index',
    reportIndexes.some((ix) => ix.unique && ix.key && ix.key.reportedBy === 1 && ix.key.clientId === 1),
    reportIndexes.map((i) => i.name),
  );
  check(
    'reports has compound {mergedInto, createdAt} index',
    reportIndexes.some((ix) => ix.key && 'mergedInto' in ix.key && 'createdAt' in ix.key),
    reportIndexes.map((i) => i.name),
  );

  const a = await User.create({ name: 'A', phone: '+919000000001', passwordHash: 'x', role: 'citizen' });
  const b = await User.create({ name: 'B', phone: '+919000000002', passwordHash: 'x', role: 'citizen' });
  check('two citizens may both omit email (unique-sparse)', !!a._id && !!b._id);
  const n1 = await User.create({ name: 'N1', email: 'n1@x.test', passwordHash: 'x', role: 'ngo' });
  const n2 = await User.create({ name: 'N2', email: 'n2@x.test', passwordHash: 'x', role: 'ngo' });
  check('two NGOs may both omit phone (unique-sparse)', !!n1._id && !!n2._id);
  check('NGOs have empty capabilities by default', Array.isArray(n1.capabilities) && n1.capabilities.length === 0);

  let dupRejected = false;
  try {
    await User.create({ name: 'A2', phone: '+919000000001', passwordHash: 'x', role: 'citizen' });
  } catch (err) {
    dupRejected = err.code === 11000;
  }
  check('duplicate phone is rejected (unique-sparse)', dupRejected);

  let roleRejected = false;
  try {
    await User.create({ name: 'X', phone: '+919000000003', passwordHash: 'x', role: 'admin' });
  } catch (err) {
    roleRejected = err.name === 'ValidationError';
  }
  check('role enum rejects "admin" (citizen|ngo|government only)', roleRejected);

  const audit = await ClaimAudit.create({
    reportId: new mongoose.Types.ObjectId(),
    needType: 'medical',
    action: 'claimed',
  });
  let blocked = false;
  try {
    await ClaimAudit.updateOne({ _id: audit._id }, { $set: { action: 'released' } });
  } catch (err) {
    blocked = /append-only/.test(err.message);
  }
  check('claimaudits mutation hook blocks updates', blocked);

  let delBlocked = false;
  try {
    await ClaimAudit.deleteOne({ _id: audit._id });
  } catch (err) {
    delBlocked = /append-only/.test(err.message);
  }
  check('claimaudits mutation hook blocks deletes', delBlocked);

  await Promise.all([
    User.deleteMany({}),
    Report.deleteMany({}),
    ClaimAudit.collection.deleteMany({}),
  ]);
}

// ─── Phase 2: auth, identity, government bootstrap ─────────────────────────
async function phase2Auth() {
  section('phase 2 — auth, identity, government bootstrap');
  const { default: mongoose } = await import('mongoose');
  const { User } = await import('../src/models/User.js');
  // Keep the bootstrapped government user; clear any leftovers from earlier runs.
  await User.deleteMany({ role: { $ne: 'government' } });

  // Registration requires consent.
  const noConsent = await api('POST', '/auth/register', {
    body: { name: 'No Consent', phone: '9000000001', password: 'Password123!' },
  });
  check('register without consent -> 422', noConsent.status === 422, noConsent.body);

  // Bad phone -> 422.
  const badPhone = await api('POST', '/auth/register', {
    body: { name: 'Bad Phone', phone: '12345', password: 'Password123!', consent: true },
  });
  check('register with invalid phone -> 422', badPhone.status === 422, badPhone.body);

  // role=admin in body is ignored; citizen is created.
  const reg = await api('POST', '/auth/register', {
    body: { name: 'Role Tamper', phone: '9000000001', password: 'Password123!', consent: true, role: 'admin' },
  });
  check('register with role=admin -> 201', reg.status === 201, reg.body);
  check('register ignores role in body -> citizen', reg.body?.role === 'citizen', reg.body);
  check('phone stored as +91XXXXXXXXXX', reg.body?.phone === '+919000000001', reg.body);
  check('consentAt stored', !!reg.body?.consentAt, reg.body);
  check('basic identity mode -> identityVerified=false', reg.body?.identityVerified === false, reg.body);
  const citizenId = reg.body?.id;
  const citizenToken = reg.body?.token;

  // Log in with phone (citizen).
  const loginPhone = await api('POST', '/auth/login', { body: { phone: '9000000001', password: 'Password123!' } });
  check('citizen login by phone -> 200', loginPhone.status === 200 && !!loginPhone.body?.token, loginPhone.body);
  const loginBad = await api('POST', '/auth/login', { body: { phone: '9000000001', password: 'wrong' } });
  check('bad password -> 401', loginBad.status === 401, loginBad.body);

  // /auth/me role comes from the DB, not the token.
  check('token payload claims citizen', decodeJwt(citizenToken).role === 'citizen');
  await mongoose.connection.collection('users').updateOne(
    { phone: '+919000000001' },
    { $set: { role: 'government' } },
  );
  const me = await api('GET', '/auth/me', { token: citizenToken });
  check('/auth/me reflects database role (government)', me.status === 200 && me.body?.role === 'government', me.body);
  check('token itself still claims citizen', decodeJwt(citizenToken).role === 'citizen');
  await mongoose.connection.collection('users').updateOne(
    { _id: new mongoose.Types.ObjectId(citizenId) },
    { $set: { role: 'citizen' } },
  );

  // Suspension -> 401.
  await mongoose.connection.collection('users').updateOne(
    { phone: '+919000000001' },
    { $set: { isSuspended: true } },
  );
  const suspended = await api('GET', '/auth/me', { token: citizenToken });
  check('suspended user -> 401', suspended.status === 401, suspended.body);
  await mongoose.connection.collection('users').updateOne(
    { phone: '+919000000001' },
    { $set: { isSuspended: false } },
  );

  // Identity mode is basic; DigiLocker routes 501.
  const mode = await api('GET', '/identity/mode');
  check('identity mode is basic', mode.status === 200 && mode.body?.mode === 'basic', mode.body);
  const dl = await api('GET', '/identity/digilocker/start', { token: citizenToken });
  check('digilocker start in basic mode -> 501 (basic mode unbroken)', dl.status === 501, dl.body);

  // Government bootstrap from env (server start).
  const govLogin = await api('POST', '/auth/login', {
    body: { email: TEST_GOV_EMAIL, password: TEST_GOV_PASSWORD },
  });
  check('bootstrapped government login -> 200', govLogin.status === 200 && govLogin.body?.role === 'government', govLogin.body);
  shared.govToken = govLogin.body?.token;
  check('bootstrapped government mustChangePassword=true', govLogin.body?.mustChangePassword === true, govLogin.body);
  const govCount = await User.countDocuments({ role: 'government' });
  check('exactly one government user exists', govCount === 1, { govCount });

  // The mustChangePassword gate applies to government too: government routes
  // are 403 until the temporary password is replaced.
  const govGated = await api('GET', '/gov/gaps', { token: shared.govToken });
  check('mustChangePassword blocks government routes -> 403', govGated.status === 403, govGated.body);
  const govChange = await api('POST', '/auth/change-password', {
    token: shared.govToken,
    body: { currentPassword: TEST_GOV_PASSWORD, newPassword: TEST_GOV_STABLE_PASSWORD },
  });
  check('government changes its temporary password -> 200', govChange.status === 200, govChange.body);
  check('government mustChangePassword cleared', govChange.body?.mustChangePassword === false, govChange.body);
  const govAfter = await api('GET', '/gov/gaps', { token: shared.govToken });
  check('government routes work after the password change -> 200', govAfter.status === 200, govAfter.body);

  // Leave the government user in place for later phases; clear test citizens.
  await User.deleteMany({ role: 'citizen' });
}

// ─── Phase 4: core report logic (service level) ────────────────────────────
async function mkUser({ name, role = 'citizen', phone, email, capabilities, organizationName }) {
  const { User } = await import('../src/models/User.js');
  return User.create({
    name,
    role,
    ...(phone ? { phone } : {}),
    ...(email ? { email } : {}),
    ...(capabilities ? { capabilities } : {}),
    ...(organizationName ? { organizationName } : {}),
    passwordHash: 'x',
    ...(role === 'citizen' ? { consentAt: new Date() } : {}),
  });
}

function expectReject(promise) {
  return promise.then(
    () => ({ rejected: false, err: null }),
    (err) => ({ rejected: true, err }),
  );
}

async function phase4CoreLogic() {
  section('phase 4 — core report logic (service level)');
  const { User } = await import('../src/models/User.js');
  const { Report } = await import('../src/models/Report.js');
  const { ClaimAudit } = await import('../src/models/ClaimAudit.js');
  const svc = await import('../src/services/reportService.js');

  await Promise.all([User.deleteMany({}), Report.deleteMany({}), ClaimAudit.collection.deleteMany({})]);

  const citizenA = await mkUser({ name: 'Citizen A', phone: '+919000001001' });
  const citizenB = await mkUser({ name: 'Citizen B', phone: '+919000001002' });
  const ngoM = await mkUser({ name: 'Med NGO', role: 'ngo', email: 'med@n.test', capabilities: ['medical'] });
  const ngoM2 = await mkUser({ name: 'Med NGO 2', role: 'ngo', email: 'med2@n.test', capabilities: ['medical'] });
  const ngoF = await mkUser({ name: 'Food NGO', role: 'ngo', email: 'food@n.test', capabilities: ['food'] });
  const ngoR1 = await mkUser({ name: 'Rescue NGO 1', role: 'ngo', email: 'r1@n.test', capabilities: ['rescue'] });
  const ngoR2 = await mkUser({ name: 'Rescue NGO 2', role: 'ngo', email: 'r2@n.test', capabilities: ['rescue'] });
  const ngoS = await mkUser({ name: 'Shelter NGO', role: 'ngo', email: 's1@n.test', capabilities: ['shelter'] });

  const actor = (u) => ({ _id: u._id, _idStr: String(u._id), capabilities: u.capabilities });

  // ── Merge into the older report ──────────────────────────────────────────
  const base = { lat: 13.08, lng: 80.27 };
  const a1 = await svc.createReport({ userId: citizenA._id, needs: ['medical'], lat: base.lat, lng: base.lng, accuracyMeters: 10 });
  check('first report does not merge', a1.merged === false && String(a1.report.mergedInto) === 'null', a1.report.mergedInto);

  // ~55 m north, different user, needs a type the primary lacks.
  const b1 = await svc.createReport({ userId: citizenB._id, needs: ['food'], lat: base.lat + 0.0005, lng: base.lng, accuracyMeters: 10 });
  check('nearby newer report merges', b1.merged === true, { merged: b1.merged });
  check('merged child points at the older primary', String(b1.report.mergedInto) === String(a1.report._id), {
    child: String(b1.report.mergedInto),
    primary: String(a1.report._id),
  });
  check('primary reporterCount incremented to 2', b1.primary.reporterCount === 2, b1.primary.reporterCount);
  check('missing need type pushed as pending', b1.primary.needs.some((n) => n.type === 'food' && n.status === 'pending'), b1.primary.needs);
  check('primary mergedInto stays null (depth 1)', b1.primary.mergedInto == null, b1.primary.mergedInto);

  const children = await Report.find({ mergedInto: a1.report._id });
  check('exactly one child points at the primary (depth 1)', children.length === 1, children.length);

  // Same user, ~220 m away (only the 300 m / 6 h rule can match).
  const a2 = await svc.createReport({ userId: citizenA._id, needs: ['shelter'], lat: base.lat + 0.002, lng: base.lng, accuracyMeters: 10 });
  check('same user merges within the wider 300 m window', a2.merged === true && String(a2.report.mergedInto) === String(a1.report._id), {
    merged: a2.merged,
    into: String(a2.report.mergedInto),
  });
  check('primary reporterCount now 3', a2.primary.reporterCount === 3, a2.primary.reporterCount);

  // ── Merge only into an older report (no cycles) ──────────────────────────
  const older = await Report.findById(a1.report._id);
  const isOlder = new Date(a1.report.createdAt).getTime() <= new Date(older.createdAt).getTime();
  check('merge target is the older report', isOlder);

  // ── Accuracy spam flag ───────────────────────────────────────────────────
  const spammy = await svc.createReport({ userId: citizenA._id, needs: ['rescue'], lat: 12.5, lng: 79.0, accuracyMeters: 1500 });
  check('accuracy > 1000 m sets low_accuracy flag', spammy.report.flags.includes('low_accuracy'), spammy.report.flags);

  // ── Excessive merges flag (> 5 merges into one report from one user) ─────
  const fBase = { lat: 11.0, lng: 78.0 };
  let fam = await svc.createReport({ userId: citizenA._id, needs: ['food'], lat: fBase.lat, lng: fBase.lng, accuracyMeters: 5 });
  for (let i = 0; i < 6; i += 1) {
    // ~11 m steps: all within the same-user 300 m radius.
    fam = await svc.createReport({ userId: citizenA._id, needs: ['food'], lat: fBase.lat + i * 0.0001, lng: fBase.lng, accuracyMeters: 5 });
  }
  const flagged = await Report.findById(fam.primary._id);
  check('more than 5 merges from one user flags excessive_merges', flagged.flags.includes('excessive_merges'), flagged.flags);

  // ── Claim race: two NGOs, exactly one wins ───────────────────────────────
  const race = await svc.createReport({ userId: citizenA._id, needs: ['rescue'], lat: 13.20, lng: 80.10, accuracyMeters: 10 });
  const [r1, r2] = await Promise.all([
    expectReject(svc.claimNeed({ reportId: race.report._id, needType: 'rescue', actor: actor(ngoR1) })),
    expectReject(svc.claimNeed({ reportId: race.report._id, needType: 'rescue', actor: actor(ngoR2) })),
  ]);
  const wins = [r1, r2].filter((r) => !r.rejected).length;
  const conflicts = [r1, r2].filter((r) => r.rejected && r.err.statusCode === 409).length;
  check('claim race: exactly one NGO wins', wins === 1, { r1: r1.rejected, r2: r2.rejected });
  check('claim race: the loser gets 409', conflicts === 1, { conflicts });
  const raceDoc = await Report.findById(race.report._id);
  check('claim race: the winner is recorded', ['rescue'].every((t) => raceDoc.needs.find((n) => n.type === t)?.claimedBy), raceDoc.needs);

  // ── Per-need claims: a medical NGO and a food NGO each win their own need ─
  const multi = await svc.createReport({
    userId: citizenB._id,
    needs: ['medical', 'food'],
    lat: 12.90,
    lng: 79.50,
    accuracyMeters: 10,
  });
  const medClaim = await svc.claimNeed({ reportId: multi.report._id, needType: 'medical', actor: actor(ngoM) });
  check('medical NGO claims the medical need', !!medClaim, medClaim);
  const foodClaim = await svc.claimNeed({ reportId: multi.report._id, needType: 'food', actor: actor(ngoF) });
  check('food NGO claims the food need', !!foodClaim, foodClaim);

  const medNeed = foodClaim.needs.find((n) => n.type === 'medical');
  const foodNeed = foodClaim.needs.find((n) => n.type === 'food');
  check('medical need owned by the medical NGO', String(medNeed.claimedBy) === String(ngoM._id), String(medNeed.claimedBy));
  check('food need owned by the food NGO', String(foodNeed.claimedBy) === String(ngoF._id), String(foodNeed.claimedBy));

  // Capability enforcement + already-claimed conflict.
  const wrongCap = await expectReject(svc.claimNeed({ reportId: race.report._id, needType: 'rescue', actor: actor(ngoM) }));
  check('claim without capability -> 403', wrongCap.rejected && wrongCap.err.statusCode === 403, wrongCap.err?.statusCode);
  const taken = await expectReject(svc.claimNeed({ reportId: multi.report._id, needType: 'medical', actor: actor(ngoM2) }));
  check('claiming an already-claimed need (with capability) -> 409', taken.rejected && taken.err.statusCode === 409, taken.err?.statusCode);

  // ── Forward-only status transitions ──────────────────────────────────────
  const inProg = await svc.updateNeedStatus({ reportId: multi.report._id, needType: 'medical', status: 'in_progress', actor: actor(ngoM) });
  check('claimed -> in_progress allowed', inProg.needs.find((n) => n.type === 'medical').status === 'in_progress');
  const resolved = await svc.updateNeedStatus({ reportId: multi.report._id, needType: 'medical', status: 'resolved', actor: actor(ngoM) });
  check('in_progress -> resolved allowed', resolved.needs.find((n) => n.type === 'medical').status === 'resolved');

  const backward = await expectReject(
    svc.updateNeedStatus({ reportId: multi.report._id, needType: 'medical', status: 'in_progress', actor: actor(ngoM) }),
  );
  check('backward status move -> 409', backward.rejected && backward.err.statusCode === 409, backward.err?.statusCode);

  const notOwner = await expectReject(
    svc.updateNeedStatus({ reportId: multi.report._id, needType: 'food', status: 'in_progress', actor: actor(ngoM) }),
  );
  check('non-claiming NGO status move -> 403', notOwner.rejected && notOwner.err.statusCode === 403, notOwner.err?.statusCode);

  // ── Release returns the need to pending ──────────────────────────────────
  const released = await svc.releaseNeed({ reportId: multi.report._id, needType: 'food', actor: actor(ngoF) });
  const foodAfter = released.needs.find((n) => n.type === 'food');
  check('release returns the need to pending', foodAfter.status === 'pending' && foodAfter.claimedBy == null, foodAfter);

  // ── Audit trail written for claim/status/release ─────────────────────────
  const audits = await ClaimAudit.find({ reportId: multi.report._id }).sort({ timestamp: 1 });
  const actions = audits.map((a) => a.action);
  check('audit rows recorded for claim/status/resolved/release', ['claimed', 'status_updated', 'resolved', 'released'].every((a) => actions.includes(a)), actions);

  // ── Stale-claim sweeper (force-release + idempotent) ─────────────────────
  const stale = await svc.createReport({ userId: citizenA._id, needs: ['shelter'], lat: 13.5, lng: 78.0, accuracyMeters: 5 });
  await svc.claimNeed({ reportId: stale.report._id, needType: 'shelter', actor: actor(ngoS) });
  const fiveHoursAgo = new Date(Date.now() - 5 * 3600 * 1000);
  await Report.updateOne(
    { _id: stale.report._id },
    { $set: { 'needs.$[n].updatedAt': fiveHoursAgo } },
    { arrayFilters: [{ 'n.type': 'shelter' }] },
  );

  const swept1 = await svc.sweepStaleClaims({ staleHours: 4 });
  check('sweeper force-releases a stale claim', swept1.some((r) => r.needType === 'shelter'), swept1);
  const staleAfter = await Report.findById(stale.report._id);
  const shelterNeed = staleAfter.needs.find((n) => n.type === 'shelter');
  check('stale claim reverted to pending', shelterNeed.status === 'pending' && shelterNeed.claimedBy == null, shelterNeed);

  const sweepAudit = await ClaimAudit.find({ reportId: stale.report._id, needType: 'shelter', action: 'force_released' });
  check('sweeper logs force_released', sweepAudit.length === 1, sweepAudit.length);

  const swept2 = await svc.sweepStaleClaims({ staleHours: 4 });
  check('sweeper is idempotent (second run releases nothing)', swept2.length === 0, swept2);

  // ── Idempotency across two users ─────────────────────────────────────────
  const clientId = `idem-${Date.now()}`;
  const first = await svc.createReport({ userId: citizenA._id, needs: ['food'], lat: 12.0, lng: 78.5, accuracyMeters: 5, clientId });
  const sameUser = await svc.findReportByClientId(clientId, citizenA._id);
  check('same user + clientId resolves to the same report', String(sameUser._id) === String(first.report._id));
  const otherUser = await svc.findReportByClientId(clientId, citizenB._id);
  check('a different user does NOT resolve the first user\u2019s clientId', otherUser === null, otherUser);

  const other = await svc.createReport({ userId: citizenB._id, needs: ['shelter'], lat: 12.0, lng: 78.5, accuracyMeters: 5, clientId });
  check('different user + same clientId creates a new report', String(other.report._id) !== String(first.report._id));
  check('new report is owned by the second user', String(other.report.reportedBy) === String(citizenB._id));

  await Promise.all([User.deleteMany({}), Report.deleteMany({}), ClaimAudit.collection.deleteMany({})]);
}

// ─── Phase 4b: merge reconciler (service level) ────────────────────────────
async function phase4bMergeReconcile() {
  section('phase 4b — merge reconciler (sweeper safety net)');
  const { User } = await import('../src/models/User.js');
  const { Report } = await import('../src/models/Report.js');
  const svc = await import('../src/services/reportService.js');

  await Promise.all([User.deleteMany({}), Report.deleteMany({})]);

  const citizenA = await mkUser({ name: 'Reconcile A', phone: '+919000002001' });
  const citizenB = await mkUser({ name: 'Reconcile B', phone: '+919000002002' });
  const ngoF = await mkUser({ name: 'Reconcile Food NGO', role: 'ngo', email: 'food.rec@n.test', capabilities: ['food'] });

  const now = new Date();
  const minutesAgo = (m) => new Date(now.getTime() - m * 60 * 1000);
  const need = (type, status = 'pending', claimedBy = null) => ({
    type,
    status,
    claimedBy,
    claimedAt: status === 'pending' ? null : minutesAgo(25),
    resolvedAt: null,
    updatedAt: minutesAgo(25),
  });
  const point = (lat, lng) => ({ type: 'Point', coordinates: [lng, lat] });

  // ── Two primaries created well apart in time but inside the 2 h window ────
  // Built with Report.create (not createReport) so both stay primaries, exactly
  // as a create-time race would leave them.
  const siteA = { lat: 10.2, lng: 78.1 };
  const siteB = { lat: 10.2005, lng: 78.1 }; // ~55 m away, different user

  const older = await Report.create({
    reportedBy: citizenA._id,
    location: point(siteA.lat, siteA.lng),
    needs: [need('food')],
    mergedInto: null,
    reporterCount: 1,
    createdAt: minutesAgo(90),
  });
  const newer = await Report.create({
    reportedBy: citizenB._id,
    location: point(siteB.lat, siteB.lng),
    needs: [need('shelter')],
    mergedInto: null,
    reporterCount: 1,
    createdAt: minutesAgo(30),
  });

  const firstPass = await svc.reconcileMerges({ now });
  check('reconciler merges a duplicate pair left by a create race', firstPass.length === 1, firstPass);
  const olderAfter = await Report.findById(older._id);
  const newerAfter = await Report.findById(newer._id);
  check('the newer report is folded into the older primary', String(newerAfter.mergedInto) === String(older._id), String(newerAfter.mergedInto));
  check('the older report stays a primary', olderAfter.mergedInto == null, olderAfter.mergedInto);
  check('reporterCount reflects the reconciled merge', olderAfter.reporterCount === 2, olderAfter.reporterCount);
  check('the folded need is carried onto the primary', olderAfter.needs.some((n) => n.type === 'shelter'), olderAfter.needs.map((n) => n.type));
  check('no duplicate need type after reconcile', olderAfter.needs.filter((n) => n.type === 'shelter').length === 1);

  // ── A claim on the newer report must survive the merge ────────────────────
  const siteC = { lat: 9.6, lng: 77.3 };
  const siteD = { lat: 9.6004, lng: 77.3 }; // ~44 m away, different user

  const claimTarget = await Report.create({
    reportedBy: citizenA._id,
    location: point(siteC.lat, siteC.lng),
    needs: [need('medical')],
    mergedInto: null,
    reporterCount: 1,
    createdAt: minutesAgo(80),
  });
  const claimedChild = await Report.create({
    reportedBy: citizenB._id,
    location: point(siteD.lat, siteD.lng),
    needs: [need('food', 'claimed', ngoF._id)],
    mergedInto: null,
    reporterCount: 1,
    createdAt: minutesAgo(20),
  });

  await svc.reconcileMerges({ now });
  const claimAfter = await Report.findById(claimTarget._id);
  const foodNeed = claimAfter.needs.find((n) => n.type === 'food');
  check('a claimed need survives the reconcile merge', !!foodNeed && foodNeed.status === 'claimed', foodNeed);
  check('the surviving claim keeps its owner', !!foodNeed && String(foodNeed.claimedBy) === String(ngoF._id), foodNeed?.claimedBy);
  check('the primary keeps its own untouched need', claimAfter.needs.some((n) => n.type === 'medical' && n.status === 'pending'));

  // ── Reconcile is idempotent ───────────────────────────────────────────────
  const fingerprint = (docs) => JSON.stringify(
    docs.map((r) => `${String(r._id)}:${String(r.mergedInto)}:${r.reporterCount}:${r.needs.map((n) => `${n.type}/${n.status}`).sort().join(',')}`),
  );
  const before = fingerprint(await Report.find({}).sort({ _id: 1 }));
  const secondPass = await svc.reconcileMerges({ now });
  const after = fingerprint(await Report.find({}).sort({ _id: 1 }));
  check('a second reconcile pass merges nothing', secondPass.length === 0, secondPass);
  check('a second reconcile pass changes no report', before === after);

  await Promise.all([User.deleteMany({}), Report.deleteMany({})]);
}

// ─── Phase 5: report + government routes (HTTP) ────────────────────────────
async function registerCitizen(phone, name) {
  const res = await api('POST', '/auth/register', {
    body: { name, phone, password: 'Password123!', consent: true },
  });
  return { id: res.body?.id, token: res.body?.token, status: res.status, body: res.body };
}

async function govCreateNgo(token, payload) {
  return api('POST', '/gov/ngos', { token, body: payload });
}

async function phase5Routes() {
  section('phase 5 — report and government routes (HTTP)');
  const { Report } = await import('../src/models/Report.js');
  const { ClaimAudit } = await import('../src/models/ClaimAudit.js');
  await Promise.all([Report.deleteMany({}), ClaimAudit.collection.deleteMany({})]);

  const citizen1 = await registerCitizen('9000000010', 'Route Citizen One');
  const citizen2 = await registerCitizen('9000000011', 'Route Citizen Two');
  check('citizen 1 registered', citizen1.status === 201 && !!citizen1.token, citizen1.body);
  check('citizen 2 registered', citizen2.status === 201 && !!citizen2.token, citizen2.body);

  // ── Government provisions NGOs ───────────────────────────────────────────
  const medNgo = await govCreateNgo(shared.govToken, {
    name: 'Medical Responders',
    email: 'medical.route@aidpulse.test',
    organizationName: 'Medical Responders TN',
    capabilities: ['medical'],
    password: 'MedTemp123!',
  });
  check('government provisions a medical NGO -> 201', medNgo.status === 201, medNgo.body);
  check('NGO created with mustChangePassword=true', medNgo.body?.ngo?.mustChangePassword === true, medNgo.body);
  check('temporary password returned once', typeof medNgo.body?.tempPassword === 'string' && medNgo.body.tempPassword.length > 0, medNgo.body);

  const foodNgo = await govCreateNgo(shared.govToken, {
    name: 'Food Responders',
    email: 'food.route@aidpulse.test',
    organizationName: 'Food Responders TN',
    capabilities: ['food'],
    password: 'FoodTemp123!',
  });
  check('government provisions a food NGO -> 201', foodNgo.status === 201, foodNgo.body);

  const rescueNgo = await govCreateNgo(shared.govToken, {
    name: 'Rescue Responders',
    email: 'rescue.route@aidpulse.test',
    organizationName: 'Rescue Responders TN',
    capabilities: ['rescue', 'shelter'],
    password: 'RescueTemp123!',
  });
  check('government provisions a rescue NGO -> 201', rescueNgo.status === 201, rescueNgo.body);

  // A second medical NGO so we can prove "already claimed -> 409" with an
  // organisation that actually holds the capability.
  const medNgo2 = await govCreateNgo(shared.govToken, {
    name: 'Medical Responders Two',
    email: 'medical2.route@aidpulse.test',
    organizationName: 'Medical Responders TN',
    capabilities: ['medical'],
    password: 'MedTemp123!',
  });
  check('government provisions a second medical NGO -> 201', medNgo2.status === 201, medNgo2.body);

  // A citizen must not be able to provision NGOs.
  const citizenNgos = await api('POST', '/gov/ngos', {
    token: citizen1.token,
    body: { name: 'x', email: 'x@y.test', capabilities: ['food'] },
  });
  check('citizen cannot provision NGOs -> 403', citizenNgos.status === 403, citizenNgos.body);

  // ── NGO password change on first login ───────────────────────────────────
  const medLogin = await api('POST', '/auth/login', { body: { email: 'medical.route@aidpulse.test', password: 'MedTemp123!' } });
  check('NGO logs in with temp password -> 200', medLogin.status === 200 && medLogin.body?.role === 'ngo', medLogin.body);
  check('NGO mustChangePassword=true on first login', medLogin.body?.mustChangePassword === true, medLogin.body);
  const medToken = medLogin.body?.token;

  const changePw = await api('POST', '/auth/change-password', {
    token: medToken,
    body: { currentPassword: 'MedTemp123!', newPassword: 'MedStable123!' },
  });
  check('NGO changes password -> 200', changePw.status === 200, changePw.body);
  check('mustChangePassword cleared after change', changePw.body?.mustChangePassword === false, changePw.body);

  const medLogin2 = await api('POST', '/auth/login', { body: { email: 'medical.route@aidpulse.test', password: 'MedStable123!' } });
  check('NGO logs in with new password -> 200', medLogin2.status === 200, medLogin2.body);
  const medToken2 = medLogin2.body?.token;

  const med2Login = await api('POST', '/auth/login', { body: { email: 'medical2.route@aidpulse.test', password: 'MedTemp123!' } });
  const medToken2b = med2Login.body?.token;
  check('second medical NGO logs in -> 200', med2Login.status === 200 && !!medToken2b, med2Login.body);
  // Every provisioned NGO starts gated by mustChangePassword; clear it before
  // any of them touches a non-whitelisted route.
  const med2Change = await api('POST', '/auth/change-password', {
    token: medToken2b,
    body: { currentPassword: 'MedTemp123!', newPassword: 'MedTwoStable123!' },
  });
  check('second medical NGO clears mustChangePassword -> 200', med2Change.status === 200, med2Change.body);

  const foodLogin = await api('POST', '/auth/login', { body: { email: 'food.route@aidpulse.test', password: 'FoodTemp123!' } });
  const foodToken = foodLogin.body?.token;
  check('food NGO logs in -> 200', foodLogin.status === 200 && !!foodToken, foodLogin.body);
  const foodChange = await api('POST', '/auth/change-password', {
    token: foodToken,
    body: { currentPassword: 'FoodTemp123!', newPassword: 'FoodStable123!' },
  });
  check('food NGO clears mustChangePassword -> 200', foodChange.status === 200, foodChange.body);

  const rescueLogin = await api('POST', '/auth/login', { body: { email: 'rescue.route@aidpulse.test', password: 'RescueTemp123!' } });
  const rescueToken = rescueLogin.body?.token;
  check('rescue NGO logs in -> 200', rescueLogin.status === 200 && !!rescueToken, rescueLogin.body);
  const rescueChange = await api('POST', '/auth/change-password', {
    token: rescueToken,
    body: { currentPassword: 'RescueTemp123!', newPassword: 'RescueStable123!' },
  });
  check('rescue NGO clears mustChangePassword -> 200', rescueChange.status === 200, rescueChange.body);

  // ── Validation: region + needs ───────────────────────────────────────────
  const outsideLat = await api('POST', '/reports', { token: citizen1.token, body: { needs: ['food'], lat: 20, lng: 77 } });
  check('latitude outside Tamil Nadu -> 422', outsideLat.status === 422, outsideLat.body);
  const outsideLng = await api('POST', '/reports', { token: citizen1.token, body: { needs: ['food'], lat: 12, lng: 70 } });
  check('longitude outside Tamil Nadu -> 422', outsideLng.status === 422, outsideLng.body);
  const emptyNeeds = await api('POST', '/reports', { token: citizen1.token, body: { needs: [], lat: 12.5, lng: 80 } });
  check('empty needs -> 422', emptyNeeds.status === 422, emptyNeeds.body);
  const waterNeed = await api('POST', '/reports', { token: citizen1.token, body: { needs: ['water'], lat: 12.5, lng: 80 } });
  check('unsupported need type \"water\" -> 422', waterNeed.status === 422, waterNeed.body);
  const dupNeeds = await api('POST', '/reports', { token: citizen1.token, body: { needs: ['food', 'food'], lat: 12.5, lng: 80 } });
  check('duplicate need types -> 422', dupNeeds.status === 422, dupNeeds.body);

  // ── Per-need claims over HTTP ────────────────────────────────────────────
  const multi = await api('POST', '/reports', {
    token: citizen1.token,
    body: { needs: ['medical', 'food'], lat: 12.5, lng: 80.0, accuracyMeters: 10 },
  });
  check('citizen creates a medical+food report -> 201', multi.status === 201, multi.body);
  const multiId = multi.body?.id;

  const medClaim = await api('POST', `/reports/${multiId}/needs/medical/claim`, { token: medToken2 });
  check('medical NGO claims medical need -> 200', medClaim.status === 200, medClaim.body);

  const foodClaim = await api('POST', `/reports/${multiId}/needs/food/claim`, { token: foodToken });
  check('food NGO claims food need -> 200', foodClaim.status === 200, foodClaim.body);

  const crossClaim = await api('POST', `/reports/${multiId}/needs/medical/claim`, { token: medToken2b });
  check('second medical NGO claims an already-claimed need -> 409', crossClaim.status === 409, crossClaim.body);

  const rescueOnMulti = await api('POST', `/reports/${multiId}/needs/food/claim`, { token: rescueToken });
  check('NGO without capability -> 403', rescueOnMulti.status === 403, rescueOnMulti.body);

  const statusUp = await api('PATCH', `/reports/${multiId}/needs/medical/status`, {
    token: medToken2,
    body: { status: 'in_progress' },
  });
  check('medical claim -> in_progress -> 200', statusUp.status === 200, statusUp.body);

  const statusBack = await api('PATCH', `/reports/${multiId}/needs/medical/status`, {
    token: medToken2,
    body: { status: 'pending' },
  });
  check('backward status -> 409', statusBack.status === 409, statusBack.body);

  const statusWrongOwner = await api('PATCH', `/reports/${multiId}/needs/food/status`, {
    token: medToken2,
    body: { status: 'in_progress' },
  });
  check('non-owner status move -> 403', statusWrongOwner.status === 403, statusWrongOwner.body);

  const releaseFood = await api('POST', `/reports/${multiId}/needs/food/release`, { token: foodToken });
  check('food NGO releases its need -> 200', releaseFood.status === 200, releaseFood.body);
  check('released need returns to pending', releaseFood.body?.needs?.find((n) => n.type === 'food')?.status === 'pending', releaseFood.body?.needs);

  // ── Government force-release ─────────────────────────────────────────────
  const forceRel = await api('POST', '/gov/force-release', {
    token: shared.govToken,
    body: { reportId: multiId, needType: 'medical' },
  });
  check('government force-releases a claimed need -> 200', forceRel.status === 200 && forceRel.body?.released === 1, forceRel.body);
  check('force-released need is pending', forceRel.body?.report?.needs?.find((n) => n.type === 'medical')?.status === 'pending', forceRel.body);

  // ── Feed filters ─────────────────────────────────────────────────────────
  const citizenFeed = await api('GET', '/reports', { token: citizen1.token });
  check('citizen feed -> 200 array', citizenFeed.status === 200 && Array.isArray(citizenFeed.body), citizenFeed.body);
  check('citizen feed hides reporter identity', citizenFeed.body.every((r) => r.reportedBy === null), citizenFeed.body[0]);

  const medFeed = await api('GET', '/reports', { token: medToken2 });
  check('medical NGO feed -> 200', medFeed.status === 200 && Array.isArray(medFeed.body), medFeed.body);
  check(
    'medical NGO feed only contains medical-capable reports',
    medFeed.body.every((r) => r.needs.some((n) => n.type === 'medical')),
    medFeed.body.map((r) => r.needs.map((n) => n.type)),
  );

  const medFoodFeed = await api('GET', '/reports?needType=food', { token: medToken2 });
  check('medical NGO cannot filter the feed to food -> empty', medFoodFeed.status === 200 && medFoodFeed.body.length === 0, medFoodFeed.body);

  const govFeed = await api('GET', '/reports', { token: shared.govToken });
  check('government sees the full feed', govFeed.status === 200 && govFeed.body.length > 0, govFeed.body?.length);

  const mine = await api('GET', '/reports/mine', { token: citizen1.token });
  check('GET /reports/mine -> 200 array', mine.status === 200 && Array.isArray(mine.body), mine.body);
  check('mine includes the created report', mine.body.some((r) => r.id === multiId), mine.body.map((r) => r.id));

  // ── Government read routes ───────────────────────────────────────────────
  const notGovGaps = await api('GET', '/gov/gaps', { token: citizen1.token });
  check('citizen cannot read government routes -> 403', notGovGaps.status === 403, notGovGaps.body);

  const gaps = await api('GET', '/gov/gaps', { token: shared.govToken });
  check('government gaps -> 200 array', gaps.status === 200 && Array.isArray(gaps.body), gaps.body);

  const clusters = await api('GET', '/gov/clusters', { token: shared.govToken });
  check('government clusters -> 200 array', clusters.status === 200 && Array.isArray(clusters.body), clusters.body);

  const ngos = await api('GET', '/gov/ngos', { token: shared.govToken });
  check('government lists NGOs', ngos.status === 200 && ngos.body.length >= 3, ngos.body?.length);

  const flags = await api('GET', '/gov/flags', { token: shared.govToken });
  check('government flags review -> 200 array', flags.status === 200 && Array.isArray(flags.body), flags.body);

  // ── Suspension ───────────────────────────────────────────────────────────
  const suspend = await api('POST', `/gov/users/${citizen2.id}/suspend`, { token: shared.govToken });
  check('government suspends a citizen -> 200', suspend.status === 200 && suspend.body?.isSuspended === true, suspend.body);
  const suspendedMe = await api('GET', '/auth/me', { token: citizen2.token });
  check('suspended citizen -> 401', suspendedMe.status === 401, suspendedMe.body);
  const restore = await api('POST', `/gov/users/${citizen2.id}/restore`, { token: shared.govToken });
  check('government restores a citizen -> 200', restore.status === 200 && restore.body?.isSuspended === false, restore.body);
  const restoredMe = await api('GET', '/auth/me', { token: citizen2.token });
  check('restored citizen -> 200', restoredMe.status === 200, restoredMe.body);

  // ── Rate limit: 10 new reports / 10 min, idempotent retries excluded ─────
  const rateUser = await registerCitizen('9000000019', 'Rate Limit Citizen');
  const firstClientId = `rl-${Date.now()}`;
  let createdCount = 0;
  let gotLimited = false;
  for (let i = 0; i < 11; i += 1) {
    const res = await api('POST', '/reports', {
      token: rateUser.token,
      body: {
        needs: ['food'],
        lat: 10.0 + i * 0.01,
        lng: 77.0,
        accuracyMeters: 5,
        ...(i === 0 ? { clientId: firstClientId } : {}),
      },
    });
    if (res.status === 201) createdCount += 1;
    else if (res.status === 429) gotLimited = true;
  }
  check('11th new report within 10 minutes -> 429', createdCount === 10 && gotLimited, { createdCount, gotLimited });

  const retry = await api('POST', '/reports', {
    token: rateUser.token,
    body: { needs: ['food'], lat: 10.0, lng: 77.0, accuracyMeters: 5, clientId: firstClientId },
  });
  check('idempotent retry does NOT consume rate limit -> 200', retry.status === 200 && !!retry.body?.id, { status: retry.status, body: retry.body });

  shared.citizen1 = citizen1;
  shared.citizen2 = citizen2;
  shared.medToken = medToken2;
  shared.foodToken = foodToken;
  shared.rescueToken = rescueToken;
  shared.multiId = multiId;
}

// ─── Phase 6: realtime events and rooms ────────────────────────────────────
function recordEvents(socket, events) {
  const counts = {};
  const payloads = [];
  for (const event of events) {
    socket.on(event, (payload) => {
      counts[event] = (counts[event] || 0) + 1;
      payloads.push({ event, payload });
    });
  }
  return { counts, payloads };
}

function connectSocket(origin, token) {
  return new Promise((resolve, reject) => {
    import('socket.io-client').then(({ io }) => {
      const socket = io(origin, {
        transports: ['websocket'],
        auth: token ? { token } : {},
        timeout: 4000,
      });
      const timer = setTimeout(() => {
        socket.disconnect();
        reject(new Error('socket connect timeout'));
      }, 6000);
      socket.on('connect_error', (err) => {
        clearTimeout(timer);
        socket.disconnect();
        reject(err);
      });
      socket.on('connected', (payload) => {
        clearTimeout(timer);
        resolve({ socket, payload });
      });
    }).catch(reject);
  });
}

async function expectSocketReject(origin, token) {
  const { io } = await import('socket.io-client');
  return new Promise((resolve) => {
    const socket = io(origin, { transports: ['websocket'], auth: token ? { token } : {}, timeout: 3000 });
    const timer = setTimeout(() => {
      socket.disconnect();
      resolve({ connected: false, reason: null });
    }, 4000);
    socket.on('connected', () => {
      clearTimeout(timer);
      socket.disconnect();
      resolve({ connected: true });
    });
    socket.on('connect_error', (err) => {
      clearTimeout(timer);
      socket.disconnect();
      resolve({ connected: false, reason: err.message });
    });
  });
}

async function phase6Realtime() {
  section('phase 6 — realtime events and rooms');
  const { Report } = await import('../src/models/Report.js');
  const origin = baseUrl.replace(/\/api$/, '');

  const gov = await connectSocket(origin, shared.govToken);
  const med = await connectSocket(origin, shared.medToken);
  const citizen = await connectSocket(origin, shared.citizen2.token);

  check('government socket joins the government room', gov.payload.rooms.includes('government'), gov.payload.rooms);
  check('medical NGO socket joins ngo + cap:medical', med.payload.rooms.includes('ngo') && med.payload.rooms.includes('cap:medical'), med.payload.rooms);
  check('citizen socket joins only its own user room', citizen.payload.rooms.includes(`user:${shared.citizen2.id}`) && !citizen.payload.rooms.includes('government') && !citizen.payload.rooms.includes('ngo'), citizen.payload.rooms);

  const govLog = recordEvents(gov.socket, ['report:new', 'report:status_updated', 'report:claimed', 'gap:alert']);
  const medLog = recordEvents(med.socket, ['report:claimed']);

  // ── report:new, then a merge emits report:status_updated instead ─────────
  const isolated = { lat: 12.7, lng: 80.1 };
  const rtA = await api('POST', '/reports', {
    token: shared.citizen2.token,
    body: { needs: ['rescue'], lat: isolated.lat, lng: isolated.lng, accuracyMeters: 8 },
  });
  check('isolated report created -> 201', rtA.status === 201, rtA.body);
  await sleep(600);

  const rtB = await api('POST', '/reports', {
    token: shared.citizen1.token,
    body: { needs: ['food'], lat: isolated.lat + 0.0005, lng: isolated.lng, accuracyMeters: 8 },
  });
  check('nearby report merges into the first', rtB.body?.mergedInto === rtA.body?.id, rtB.body);
  await sleep(800);

  check('merged report does NOT emit report:new', (govLog.counts['report:new'] || 0) === 1, govLog.counts);
  check('merged report emits report:status_updated', (govLog.counts['report:status_updated'] || 0) >= 1, govLog.counts);

  // ── claim event reaches the capability room + government ─────────────────
  const rtClaim = await api('POST', '/reports', {
    token: shared.citizen1.token,
    body: { needs: ['medical'], lat: 12.9, lng: 80.3, accuracyMeters: 8 },
  });
  const claimId = rtClaim.body?.id;
  check('claim-target report created -> 201', rtClaim.status === 201, rtClaim.body);
  await sleep(500);

  const claim = await api('POST', `/reports/${claimId}/needs/medical/claim`, { token: shared.medToken });
  check('medical NGO claims over HTTP -> 200', claim.status === 200, claim.body);
  await sleep(800);

  check('claim event reaches the medical capability room', (medLog.counts['report:claimed'] || 0) >= 1, medLog.counts);
  check('claim event also reaches government', (govLog.counts['report:claimed'] || 0) >= 1, govLog.counts);

  // ── gap:alert fires once per cell state change ───────────────────────────
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
  const cell = { lat: 13.05, lng: 80.25 };
  for (let i = 0; i < 3; i += 1) {
    await Report.create({
      reportedBy: shared.citizen2.id,
      location: { type: 'Point', coordinates: [cell.lng + i * 0.0001, cell.lat + i * 0.0001] },
      needs: [{ type: 'rescue', status: 'pending', updatedAt: twoHoursAgo }],
      accuracyMeters: 5,
      createdAt: twoHoursAgo,
    });
  }
  await sleep(400);

  const scan1 = await api('POST', '/gov/gaps/scan', { token: shared.govToken });
  check('first gap scan detects changed cells', scan1.status === 200 && scan1.body?.changed?.length >= 1, scan1.body);
  await sleep(800);
  const alertsAfterFirst = govLog.counts['gap:alert'] || 0;
  check('government receives gap:alert', alertsAfterFirst >= 1, { alertsAfterFirst });

  const scan2 = await api('POST', '/gov/gaps/scan', { token: shared.govToken });
  check('unchanged second scan emits no new alert', scan2.status === 200 && scan2.body?.changed?.length === 0, scan2.body);
  await sleep(800);
  check('gap:alert count did not increase', (govLog.counts['gap:alert'] || 0) === alertsAfterFirst, {
    before: alertsAfterFirst,
    after: govLog.counts['gap:alert'],
  });

  // ── Handshake authentication ─────────────────────────────────────────────
  const noToken = await expectSocketReject(origin, null);
  check('socket handshake without token is rejected', noToken.connected === false, noToken);
  const badToken = await expectSocketReject(origin, 'not.a.valid.token');
  check('socket handshake with invalid token is rejected', badToken.connected === false, badToken);

  gov.socket.disconnect();
  med.socket.disconnect();
  citizen.socket.disconnect();

  await Promise.all([Report.deleteMany({})]);
}

// ─── Phase 7a: concurrent merge determinism (service level) ────────────────
async function phase7ConcurrentMerge() {
  section('phase 7a — concurrent merge determinism (service level)');
  const { User } = await import('../src/models/User.js');
  const { Report } = await import('../src/models/Report.js');
  const { ClaimAudit } = await import('../src/models/ClaimAudit.js');
  const svc = await import('../src/services/reportService.js');

  await Promise.all([User.deleteMany({}), Report.deleteMany({}), ClaimAudit.collection.deleteMany({})]);

  let seq = 0;
  const newCitizen = () =>
    mkUser({ name: `Merge Citizen ${seq}`, phone: `+9195${String(seq++).padStart(8, '0')}` });

  let onePrimary = true;
  let childPointsAtPrimary = true;
  let depthOne = true;
  let noCycle = true;
  const issues = [];

  for (let i = 0; i < 20; i += 1) {
    // Distinct, far-apart cells across Tamil Nadu so iterations never merge
    // into one another and each citizen stays well under the rate limit.
    const lat = 8.0 + Math.floor(i / 4) * 0.5;
    const lng = 76.5 + (i % 4) * 0.5;
    const u1 = await newCitizen();
    const u2 = await newCitizen();

    const [r1, r2] = await Promise.all([
      svc.createReport({ userId: u1._id, needs: ['medical'], lat, lng, accuracyMeters: 5 }),
      svc.createReport({ userId: u2._id, needs: ['food'], lat, lng, accuracyMeters: 5 }),
    ]);

    const docs = await Report.find({ _id: { $in: [r1.report._id, r2.report._id] } });
    const primaries = docs.filter((d) => d.mergedInto == null);
    const children = docs.filter((d) => d.mergedInto != null);

    if (primaries.length !== 1) {
      onePrimary = false;
      issues.push({ i, primaries: primaries.length });
      continue;
    }
    const primary = primaries[0];
    if (primary.mergedInto != null) noCycle = false;

    if (children.length !== 1) {
      childPointsAtPrimary = false;
      issues.push({ i, children: children.length });
      continue;
    }
    const child = children[0];
    if (String(child.mergedInto) !== String(primary._id)) {
      childPointsAtPrimary = false;
      issues.push({ i, childInto: String(child.mergedInto), primary: String(primary._id) });
    }
    // Depth must stay 1: nothing may point at the child itself.
    const grandchildren = await Report.countDocuments({ mergedInto: child._id });
    if (grandchildren > 0) depthOne = false;
  }

  check('20 concurrent 2-report merges each leave exactly one primary', onePrimary, issues.slice(0, 3));
  check('every merged child points directly at its primary', childPointsAtPrimary, issues.slice(0, 3));
  check('merge depth stays 1 (no chains)', depthOne, issues.slice(0, 3));
  check('no merge cycles form (each primary has no parent)', noCycle, issues.slice(0, 3));

  // ── 3-report concurrent variant ─────────────────────────────────────────
  {
    const users = [await newCitizen(), await newCitizen(), await newCitizen()];
    const results = await Promise.all(
      users.map((u) => svc.createReport({ userId: u._id, needs: ['rescue'], lat: 11.5, lng: 79.5, accuracyMeters: 5 })),
    );
    const docs = await Report.find({ _id: { $in: results.map((r) => r.report._id) } });
    const primaries = docs.filter((d) => d.mergedInto == null);
    const children = docs.filter((d) => d.mergedInto != null);
    const primaryId = primaries[0] ? String(primaries[0]._id) : null;

    check('3 concurrent reports leave exactly one primary', primaries.length === 1, { primaries: primaries.length });
    check(
      'all non-primaries point directly at the single primary',
      children.length === 2 && children.every((c) => String(c.mergedInto) === primaryId),
      children.map((c) => String(c.mergedInto)),
    );
  }

  // ── identical createdAt -> smaller _id wins the tiebreak ─────────────────
  {
    const ta = await newCitizen();
    const tb = await newCitizen();
    const fixed = new Date(Date.now() - 60 * 1000);
    const docs = await Report.create([
      {
        reportedBy: ta._id,
        location: { type: 'Point', coordinates: [77.0, 10.5] },
        needs: [{ type: 'food', status: 'pending', updatedAt: fixed }],
        accuracyMeters: 5,
        createdAt: fixed,
      },
      {
        reportedBy: tb._id,
        location: { type: 'Point', coordinates: [77.0, 10.5] },
        needs: [{ type: 'medical', status: 'pending', updatedAt: fixed }],
        accuracyMeters: 5,
        createdAt: fixed,
      },
    ]);
    const [lower, higher] = docs.slice().sort((a, b) => (String(a._id) < String(b._id) ? -1 : 1));
    const target = await svc.findMergeTarget(higher, higher.reportedBy);
    check(
      'identical createdAt: the larger _id merges into the smaller',
      target && String(target._id) === String(lower._id),
      { target: String(target?._id), lower: String(lower._id) },
    );
    const none = await svc.findMergeTarget(lower, lower.reportedBy);
    check('identical createdAt: the smaller _id stays primary', none === null, none);
  }

  await Promise.all([User.deleteMany({}), Report.deleteMany({}), ClaimAudit.collection.deleteMany({})]);
}

// ─── Phase 7b: status / ownership / sweeper edge cases (service level) ─────
async function phase7StatusOwnership() {
  section('phase 7b — status, ownership and sweeper edge cases (service level)');
  const { User } = await import('../src/models/User.js');
  const { Report } = await import('../src/models/Report.js');
  const { ClaimAudit } = await import('../src/models/ClaimAudit.js');
  const svc = await import('../src/services/reportService.js');

  await Promise.all([User.deleteMany({}), Report.deleteMany({}), ClaimAudit.collection.deleteMany({})]);

  const citizen = await mkUser({ name: 'Owner Citizen', phone: '+919600000001' });
  const owner = await mkUser({ name: 'Owner NGO', role: 'ngo', email: 'owner.n@test', capabilities: ['medical'] });
  const other = await mkUser({ name: 'Other NGO', role: 'ngo', email: 'other.n@test', capabilities: ['medical'] });
  const noCap = await mkUser({ name: 'Food NGO', role: 'ngo', email: 'food.n@test', capabilities: ['food'] });
  const shelterNgo = await mkUser({ name: 'Shelter NGO', role: 'ngo', email: 'shelter.n@test', capabilities: ['shelter'] });
  const actor = (u) => ({ _id: u._id, _idStr: String(u._id), capabilities: u.capabilities });

  const rec = await svc.createReport({ userId: citizen._id, needs: ['medical'], lat: 9.1, lng: 78.1, accuracyMeters: 5 });
  const reportId = rec.report._id;

  // Nobody owns a pending need, so a status update on it is refused.
  const pendingUpdate = await expectReject(
    svc.updateNeedStatus({ reportId, needType: 'medical', status: 'in_progress', actor: actor(owner) }),
  );
  check('status update on an unowned (pending) need -> 403', pendingUpdate.rejected && pendingUpdate.err.statusCode === 403, pendingUpdate.err?.statusCode);

  await svc.claimNeed({ reportId, needType: 'medical', actor: actor(owner) });

  const skip = await expectReject(
    svc.updateNeedStatus({ reportId, needType: 'medical', status: 'resolved', actor: actor(owner) }),
  );
  check('claimed -> resolved (skips in_progress) -> 409', skip.rejected && skip.err.statusCode === 409, skip.err?.statusCode);
  const backward = await expectReject(
    svc.updateNeedStatus({ reportId, needType: 'medical', status: 'pending', actor: actor(owner) }),
  );
  check('claimed -> pending (backwards) -> 409', backward.rejected && backward.err.statusCode === 409, backward.err?.statusCode);

  const nonOwner = await expectReject(
    svc.updateNeedStatus({ reportId, needType: 'medical', status: 'in_progress', actor: actor(other) }),
  );
  check('non-owner (same capability) status update -> 403', nonOwner.rejected && nonOwner.err.statusCode === 403, nonOwner.err?.statusCode);
  const noCapUpdate = await expectReject(
    svc.updateNeedStatus({ reportId, needType: 'medical', status: 'in_progress', actor: actor(noCap) }),
  );
  check('non-owner (no capability) status update -> 403', noCapUpdate.rejected && noCapUpdate.err.statusCode === 403, noCapUpdate.err?.statusCode);

  const step1 = await svc.updateNeedStatus({ reportId, needType: 'medical', status: 'in_progress', actor: actor(owner) });
  check('claimed -> in_progress by owner -> 200', step1.needs.find((n) => n.type === 'medical').status === 'in_progress');
  const step2 = await svc.updateNeedStatus({ reportId, needType: 'medical', status: 'resolved', actor: actor(owner) });
  check('in_progress -> resolved by owner -> 200', step2.needs.find((n) => n.type === 'medical').status === 'resolved');
  const past = await expectReject(
    svc.updateNeedStatus({ reportId, needType: 'medical', status: 'in_progress', actor: actor(owner) }),
  );
  check('resolved -> anything -> 409', past.rejected && past.err.statusCode === 409, past.err?.statusCode);

  // ── release ownership ───────────────────────────────────────────────────
  const rec2 = await svc.createReport({ userId: citizen._id, needs: ['medical'], lat: 9.2, lng: 78.2, accuracyMeters: 5 });
  const rid2 = rec2.report._id;
  await svc.claimNeed({ reportId: rid2, needType: 'medical', actor: actor(owner) });
  const wrongRelease = await expectReject(svc.releaseNeed({ reportId: rid2, needType: 'medical', actor: actor(other) }));
  check('non-owner release -> 403', wrongRelease.rejected && wrongRelease.err.statusCode === 403, wrongRelease.err?.statusCode);
  const ownRelease = await svc.releaseNeed({ reportId: rid2, needType: 'medical', actor: actor(owner) });
  check('owner release returns the need to pending', ownRelease.needs.find((n) => n.type === 'medical').status === 'pending');
  const releaseAgain = await expectReject(svc.releaseNeed({ reportId: rid2, needType: 'medical', actor: actor(owner) }));
  check('release an unclaimed need -> 409', releaseAgain.rejected && releaseAgain.err.statusCode === 409, releaseAgain.err?.statusCode);

  // ── sweeper edge cases ───────────────────────────────────────────────────
  const rec3 = await svc.createReport({ userId: citizen._id, needs: ['shelter'], lat: 9.3, lng: 78.3, accuracyMeters: 5 });
  const rid3 = rec3.report._id;
  await svc.claimNeed({ reportId: rid3, needType: 'shelter', actor: actor(shelterNgo) });
  const fiveHoursAgo = new Date(Date.now() - 5 * 3600 * 1000);
  await Report.updateOne(
    { _id: rid3 },
    { $set: { 'needs.$[n].updatedAt': fiveHoursAgo } },
    { arrayFilters: [{ 'n.type': 'shelter' }] },
  );
  const swept = await svc.sweepStaleClaims({ staleHours: 4 });
  check('sweeper force-releases the stale claim', swept.some((r) => r.needType === 'shelter'), swept);
  const afterSweep = await Report.findById(rid3);
  const shelterNeed = afterSweep.needs.find((n) => n.type === 'shelter');
  check('swept need is pending with no owner', shelterNeed.status === 'pending' && shelterNeed.claimedBy == null, shelterNeed);

  const patchAfterSweep = await expectReject(
    svc.updateNeedStatus({ reportId: rid3, needType: 'shelter', status: 'in_progress', actor: actor(shelterNgo) }),
  );
  check('previous owner cannot update a need after the sweeper released it -> 403', patchAfterSweep.rejected && patchAfterSweep.err.statusCode === 403, patchAfterSweep.err?.statusCode);
  const releaseAfterSweep = await expectReject(
    svc.releaseNeed({ reportId: rid3, needType: 'shelter', actor: actor(shelterNgo) }),
  );
  check('previous owner cannot release after the sweeper released it -> 409', releaseAfterSweep.rejected && releaseAfterSweep.err.statusCode === 409, releaseAfterSweep.err?.statusCode);

  // ── government force-release writes an audit row ─────────────────────────
  const rec4 = await svc.createReport({ userId: citizen._id, needs: ['shelter'], lat: 9.4, lng: 78.4, accuracyMeters: 5 });
  const rid4 = rec4.report._id;
  await svc.claimNeed({ reportId: rid4, needType: 'shelter', actor: actor(shelterNgo) });
  const forced = await svc.forceReleaseNeed({ reportId: rid4, needType: 'shelter', actorId: null });
  check('government force-release works', forced.released === 1 && forced.report.needs.find((n) => n.type === 'shelter').status === 'pending', forced.released);
  const forceAudit = await ClaimAudit.countDocuments({ reportId: rid4, needType: 'shelter', action: 'force_released' });
  check('government force-release writes a force_released audit row', forceAudit === 1, forceAudit);

  await Promise.all([User.deleteMany({}), Report.deleteMany({}), ClaimAudit.collection.deleteMany({})]);
}

// ─── Phase 7h: ownership + role checks over HTTP ───────────────────────────
async function phase7OwnershipHttp() {
  section('phase 7h — ownership and role checks over HTTP');
  const base = { lat: 12.15, lng: 79.05 };
  const created = await api('POST', '/reports', {
    token: shared.citizen1.token,
    body: { needs: ['food'], lat: base.lat, lng: base.lng, accuracyMeters: 6 },
  });
  check('food report created -> 201', created.status === 201, created.body);
  const id = created.body?.id;

  const foodClaim = await api('POST', `/reports/${id}/needs/food/claim`, { token: shared.foodToken });
  check('food NGO claims the food need -> 200', foodClaim.status === 200, foodClaim.body);

  const wrongRelease = await api('POST', `/reports/${id}/needs/food/release`, { token: shared.medToken });
  check('non-owner release over HTTP -> 403', wrongRelease.status === 403, wrongRelease.body);

  const citizenStatus = await api('PATCH', `/reports/${id}/needs/food/status`, {
    token: shared.citizen1.token,
    body: { status: 'in_progress' },
  });
  check('citizen cannot update need status -> 403 (role)', citizenStatus.status === 403, citizenStatus.body);

  const skipStep = await api('PATCH', `/reports/${id}/needs/food/status`, {
    token: shared.foodToken,
    body: { status: 'resolved' },
  });
  check('owner skipping a status step over HTTP -> 409', skipStep.status === 409, skipStep.body);

  const force = await api('POST', '/gov/force-release', {
    token: shared.govToken,
    body: { reportId: id, needType: 'food' },
  });
  check('government force-release over HTTP -> 200', force.status === 200 && force.body?.released === 1, force.body);
}

// ─── Phase 7c: /reports/mine resolves merges without leaking PII ───────────
async function phase7MineMerged() {
  section('phase 7c — /reports/mine resolves merges privately');
  const other = await registerCitizen('9000000077', 'Mine Other Citizen');
  check('merged contributor registered', other.status === 201 && !!other.token, other.body);

  const base = { lat: 12.35, lng: 79.15 };
  const primaryRes = await api('POST', '/reports', {
    token: shared.citizen1.token,
    body: { needs: ['medical'], lat: base.lat, lng: base.lng, accuracyMeters: 6 },
  });
  check('primary report for mine test created -> 201', primaryRes.status === 201, primaryRes.body);
  const primaryId = primaryRes.body?.id;

  const claim = await api('POST', `/reports/${primaryId}/needs/medical/claim`, { token: shared.medToken });
  check(
    'medical need claimed on the primary',
    claim.status === 200 && claim.body?.needs?.find((n) => n.type === 'medical')?.status === 'claimed',
    claim.body,
  );

  const childRes = await api('POST', '/reports', {
    token: other.token,
    body: { needs: ['medical'], lat: base.lat + 0.0004, lng: base.lng, accuracyMeters: 6 },
  });
  check('nearby report merges into the primary', childRes.body?.mergedInto === primaryId, childRes.body);

  const mine = await api('GET', '/reports/mine', { token: other.token });
  check('merged contributor mine -> 200 array', mine.status === 200 && Array.isArray(mine.body), mine.body);
  check('mine returns exactly the primary, not the child', mine.body.length === 1 && mine.body[0].id === primaryId, mine.body.map((r) => r.id));
  check('returned report is the primary (mergedInto null)', mine.body[0].mergedInto === null, mine.body[0]);
  check(
    'the primary\u2019s need statuses are visible to the merged contributor',
    mine.body[0].needs.some((n) => n.type === 'medical' && n.status === 'claimed'),
    mine.body[0].needs,
  );

  const json = JSON.stringify(mine.body);
  check('mine leaks no other reporter id', !json.includes(shared.citizen1.id), { otherId: shared.citizen1.id });
  check('mine leaks no other reporter phone', !json.includes('+919000000010'), null);
  check('mine leaks no other reporter name', !json.includes('Route Citizen One'), null);
  check('mine hides reportedBy for citizens', mine.body[0].reportedBy === null, mine.body[0].reportedBy);
}

// ─── Phase 7d: mustChangePassword gates everything but the whitelist ───────
async function phase7MustChangePassword() {
  section('phase 7d — mustChangePassword gate');
  const { User } = await import('../src/models/User.js');
  const email = 'gate.route@aidpulse.test';
  const tempPassword = 'GateTemp123!';

  const prov = await govCreateNgo(shared.govToken, {
    name: 'Gate NGO',
    email,
    organizationName: 'Gate NGO',
    capabilities: ['food'],
    password: tempPassword,
  });
  check('government provisions a gated NGO -> 201', prov.status === 201, prov.body);

  const login = await api('POST', '/auth/login', { body: { email, password: tempPassword } });
  check('gated NGO logs in with temp password -> 200', login.status === 200 && login.body?.mustChangePassword === true, login.body);
  const token = login.body?.token;

  const bogusId = new mongoose.Types.ObjectId().toString();

  const blockedFeed = await api('GET', '/reports', { token });
  check('mustChangePassword blocks GET /reports -> 403', blockedFeed.status === 403, blockedFeed.body);
  const blockedCreate = await api('POST', '/reports', { token, body: { needs: ['food'], lat: 11.0, lng: 78.0 } });
  check('mustChangePassword blocks POST /reports -> 403', blockedCreate.status === 403, blockedCreate.body);
  const blockedClaim = await api('POST', `/reports/${bogusId}/needs/food/claim`, { token });
  check('mustChangePassword blocks claim -> 403', blockedClaim.status === 403, blockedClaim.body);
  const blockedStatus = await api('PATCH', `/reports/${bogusId}/needs/food/status`, { token, body: { status: 'in_progress' } });
  check('mustChangePassword blocks status update -> 403', blockedStatus.status === 403, blockedStatus.body);
  const blockedRelease = await api('POST', `/reports/${bogusId}/needs/food/release`, { token });
  check('mustChangePassword blocks release -> 403', blockedRelease.status === 403, blockedRelease.body);
  const blockedGov = await api('GET', '/gov/gaps', { token });
  check('mustChangePassword blocks other role routes -> 403', blockedGov.status === 403, blockedGov.body);

  const me = await api('GET', '/auth/me', { token });
  check('GET /auth/me is still allowed while gated -> 200', me.status === 200 && me.body?.mustChangePassword === true, me.body);

  // The flag is read from the database on every request, not cached in the token.
  await User.updateOne({ email }, { $set: { mustChangePassword: false } });
  const allowedByDb = await api('GET', '/reports', { token });
  check('same token is allowed once the DB flag is cleared', allowedByDb.status === 200, allowedByDb.body);
  await User.updateOne({ email }, { $set: { mustChangePassword: true } });
  const blockedAgain = await api('GET', '/reports', { token });
  check('same token is blocked again once the DB flag is restored', blockedAgain.status === 403, blockedAgain.body);

  const samePw = await api('POST', '/auth/change-password', {
    token,
    body: { currentPassword: tempPassword, newPassword: tempPassword },
  });
  check('new password identical to the temporary one -> 422', samePw.status === 422, samePw.body);

  const changed = await api('POST', '/auth/change-password', {
    token,
    body: { currentPassword: tempPassword, newPassword: 'GateStable123!' },
  });
  check('gated NGO changes its password -> 200', changed.status === 200, changed.body);
  check('mustChangePassword cleared after the change', changed.body?.mustChangePassword === false, changed.body);

  const nowAllowed = await api('GET', '/reports', { token });
  check('all routes work after the password change -> 200', nowAllowed.status === 200, nowAllowed.body);

  const relogin = await api('POST', '/auth/login', { body: { email, password: 'GateStable123!' } });
  check('gated NGO logs in with the new password -> 200', relogin.status === 200, relogin.body);
}

// ─── Phase 7e: socket room isolation ───────────────────────────────────────
async function phase7SocketIsolation() {
  section('phase 7e — socket room isolation');
  const origin = baseUrl.replace(/\/api$/, '');

  const prov = await govCreateNgo(shared.govToken, {
    name: 'Food Only NGO',
    email: 'foodonly.route@aidpulse.test',
    organizationName: 'Food Only',
    capabilities: ['food'],
    password: 'FoodOnly123!',
  });
  check('food-only NGO provisioned -> 201', prov.status === 201, prov.body);
  const foodLogin = await api('POST', '/auth/login', { body: { email: 'foodonly.route@aidpulse.test', password: 'FoodOnly123!' } });
  const foodToken = foodLogin.body?.token;
  check('food-only NGO logs in -> 200', foodLogin.status === 200 && !!foodToken, foodLogin.body);

  // A dedicated reporter keeps this phase clear of the 10-report/10-min limit
  // that shared.citizen1 has already exhausted across the earlier phases.
  const reporter = await registerCitizen('9000000099', 'Socket Reporter');
  check('socket reporter registered -> 201', reporter.status === 201 && !!reporter.token, reporter.body);

  const govSock = await connectSocket(origin, shared.govToken);
  const medSock = await connectSocket(origin, shared.medToken);
  const foodSock = await connectSocket(origin, foodToken);
  const joiner = await connectSocket(origin, shared.citizen2.token);

  check(
    'citizen socket joins only its own user room',
    joiner.payload.rooms.includes(`user:${shared.citizen2.id}`) && !joiner.payload.rooms.includes('government') && !joiner.payload.rooms.includes('ngo'),
    joiner.payload.rooms,
  );

  const foodLog = recordEvents(foodSock.socket, ['report:new', 'report:claimed', 'report:status_updated', 'gap:alert']);
  const medLog = recordEvents(medSock.socket, ['report:new', 'report:claimed']);
  const govLog = recordEvents(govSock.socket, ['report:new', 'report:claimed']);
  const joinerLog = recordEvents(joiner.socket, ['report:new', 'report:claimed', 'report:status_updated', 'gap:alert']);

  // Rooms are derived server-side only; client "join" requests must be ignored.
  joiner.socket.emit('join', 'government');
  joiner.socket.emit('join', `user:${reporter.id}`);
  await sleep(150);

  // A medical-only report: only medical-capable NGOs, the reporter and the
  // government may observe it.
  const loc = { lat: 12.45, lng: 79.25 };
  const rep = await api('POST', '/reports', {
    token: reporter.token,
    body: { needs: ['medical'], lat: loc.lat, lng: loc.lng, accuracyMeters: 6 },
  });
  check('medical-only report created -> 201', rep.status === 201, rep.body);
  const reportId = rep.body?.id;
  await sleep(700);

  const claim = await api('POST', `/reports/${reportId}/needs/medical/claim`, { token: shared.medToken });
  check('medical need claimed -> 200', claim.status === 200, claim.body);
  await sleep(800);

  check('medical-only report: food NGO receives no report:new', (foodLog.counts['report:new'] || 0) === 0, foodLog.counts);
  check('medical-only report: food NGO receives no report:claimed', (foodLog.counts['report:claimed'] || 0) === 0, foodLog.counts);
  check('medical NGO receives report:new', (medLog.counts['report:new'] || 0) >= 1, medLog.counts);
  check('medical NGO receives report:claimed', (medLog.counts['report:claimed'] || 0) >= 1, medLog.counts);
  check('government receives report:new and report:claimed', (govLog.counts['report:new'] || 0) >= 1 && (govLog.counts['report:claimed'] || 0) >= 1, govLog.counts);
  check('citizen join attempts have no effect (no events received)', Object.keys(joinerLog.counts).length === 0, joinerLog.counts);

  const invalid = await expectSocketReject(origin, 'not.a.valid.token');
  check('invalid token rejected at handshake', invalid.connected === false, invalid);
  const expired = await expectSocketReject(origin, await expiredToken(shared.citizen1.id));
  check('expired token rejected at handshake', expired.connected === false, expired);

  govSock.socket.disconnect();
  medSock.socket.disconnect();
  foodSock.socket.disconnect();
  joiner.socket.disconnect();
}

// ─── Phase 7f: gap:alert fires only on a cell state change ─────────────────
async function phase7GapDedup() {
  section('phase 7f — gap:alert only on cell state change');
  const { Report } = await import('../src/models/Report.js');
  const { gapCellKey } = await import('../src/utils/geo.js');
  const origin = baseUrl.replace(/\/api$/, '');

  const govSock = await connectSocket(origin, shared.govToken);
  const alertLog = recordEvents(govSock.socket, ['gap:alert']);

  // A fresh 0.01° cell, far from any cell the earlier phases scanned. The cell
  // key must be computed the same way the server does (`floor(coord * 100)`);
  // dividing by 0.01 drifts due to floating point. These values keep every
  // offset safely inside one cell.
  const cell = { lat: 11.66, lng: 77.86 };
  const cellKey = gapCellKey(Math.floor(cell.lat * 100), Math.floor(cell.lng * 100));
  const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
  const ourAlerts = () =>
    alertLog.payloads.filter((p) => p.event === 'gap:alert' && p.payload?.cellKey === cellKey).length;

  const makeReport = (offset) =>
    Report.create({
      reportedBy: shared.citizen1.id,
      location: { type: 'Point', coordinates: [cell.lng + offset * 0.0001, cell.lat + offset * 0.0001] },
      needs: [{ type: 'medical', status: 'pending', updatedAt: old }],
      accuracyMeters: 5,
      createdAt: old,
    });

  const cellReports = [await makeReport(0), await makeReport(1), await makeReport(2)];
  const scan = () => api('POST', '/gov/gaps/scan', { token: shared.govToken });

  // 0 -> 3
  const scan1 = await scan();
  await sleep(500);
  const a1 = ourAlerts();
  check('first scan announces the new cell (0 -> 3)', scan1.status === 200 && (scan1.body?.changed || []).some((c) => c.cellKey === cellKey), (scan1.body?.changed || []).map((c) => c.cellKey));
  check('gap:alert received for the new cell', a1 >= 1, { a1 });

  // unchanged -> silent
  await scan();
  await sleep(400);
  const a2 = ourAlerts();
  check('unchanged scan emits nothing new for the cell', a2 === a1, { before: a1, after: a2 });

  // 3 -> 4
  const fourth = await makeReport(3);
  await scan();
  await sleep(500);
  const a3 = ourAlerts();
  check('adding a need re-alerts the cell (3 -> 4)', a3 > a2, { before: a2, after: a3 });

  // 4 -> 3 (a claim removes a pending need)
  const claim1 = await api('POST', `/reports/${cellReports[0]._id}/needs/medical/claim`, { token: shared.medToken });
  check('claimed a need inside the gap cell -> 200', claim1.status === 200, claim1.body);
  await scan();
  await sleep(500);
  const a4 = ourAlerts();
  check('a claim reduces the cell and re-alerts (4 -> 3)', a4 > a3, { before: a3, after: a4 });

  // Resolve needs fully (pending count drops) -> 3 -> 2 -> 1 -> 0
  const resolve = async (reportId) => {
    await api('POST', `/reports/${reportId}/needs/medical/claim`, { token: shared.medToken });
    await api('PATCH', `/reports/${reportId}/needs/medical/status`, { token: shared.medToken, body: { status: 'in_progress' } });
    return api('PATCH', `/reports/${reportId}/needs/medical/status`, { token: shared.medToken, body: { status: 'resolved' } });
  };

  const resolved2 = await resolve(cellReports[1]._id);
  check('resolved a need inside the gap cell -> 200', resolved2.status === 200, resolved2.body);
  await scan();
  await sleep(500);
  const a5 = ourAlerts();
  check('a resolution reduces the cell and re-alerts (3 -> 2)', a5 > a4, { before: a4, after: a5 });

  await resolve(fourth._id);
  await scan();
  await sleep(500);
  const a6 = ourAlerts();
  check('another resolution re-alerts (2 -> 1)', a6 > a5, { before: a5, after: a6 });

  await resolve(cellReports[2]._id);
  const scan7 = await scan();
  await sleep(500);
  const a7 = ourAlerts();
  check('the final resolution re-alerts as the cell drops to zero (1 -> 0)', a7 > a6, { before: a6, after: a7 });
  check('the drop-to-zero alert reports count 0', (scan7.body?.changed || []).some((c) => c.cellKey === cellKey && c.count === 0), (scan7.body?.changed || []).map((c) => ({ key: c.cellKey, count: c.count })));

  // Empty cell stays silent afterwards.
  await scan();
  await sleep(400);
  const a8 = ourAlerts();
  check('an emptied cell stays silent on later scans', a8 === a7, { before: a7, after: a8 });

  // NOTE: the dedupe state is an in-memory Map in the API process, so a server
  // restart re-announces currently-qualifying cells once. Acceptable per spec.
  govSock.socket.disconnect();
}

// ─── Phase 7g: suspension (HTTP 401 + live socket disconnect + restore) ────
async function phase7SuspendedUser() {
  section('phase 7g — suspension (HTTP + live socket)');
  const origin = baseUrl.replace(/\/api$/, '');

  const citizen = await registerCitizen('9000000088', 'Suspend Me');
  check('suspend-test citizen registered -> 201', citizen.status === 201 && !!citizen.token, citizen.body);

  const sock = await connectSocket(origin, citizen.token);
  check('citizen socket connects before suspension', !!sock.payload, sock.payload);

  let disconnected = false;
  let disconnectReason = null;
  sock.socket.on('disconnect', (reason) => {
    disconnected = true;
    disconnectReason = reason;
  });

  const suspend = await api('POST', `/gov/users/${citizen.id}/suspend`, { token: shared.govToken });
  check('government suspends the citizen -> 200', suspend.status === 200 && suspend.body?.isSuspended === true, suspend.body);

  await sleep(500);
  check('already-connected socket is disconnected when its user is suspended', disconnected === true, { disconnected, disconnectReason });

  const suspendedMe = await api('GET', '/auth/me', { token: citizen.token });
  check('suspended user HTTP -> 401', suspendedMe.status === 401, suspendedMe.body);
  const suspendedCreate = await api('POST', '/reports', { token: citizen.token, body: { needs: ['food'], lat: 11.0, lng: 78.0 } });
  check('suspended user cannot create reports -> 401', suspendedCreate.status === 401, suspendedCreate.body);

  const suspendedHandshake = await expectSocketReject(origin, citizen.token);
  check('suspended user cannot open a socket', suspendedHandshake.connected === false, suspendedHandshake);

  const restore = await api('POST', `/gov/users/${citizen.id}/restore`, { token: shared.govToken });
  check('government restores the citizen -> 200', restore.status === 200 && restore.body?.isSuspended === false, restore.body);

  const restoredMe = await api('GET', '/auth/me', { token: citizen.token });
  check('restored user HTTP works -> 200', restoredMe.status === 200, restoredMe.body);
  const restoredHandshake = await connectSocket(origin, citizen.token);
  check('restored user can open a socket again', !!restoredHandshake.payload, restoredHandshake.payload);
  restoredHandshake.socket.disconnect();
}

// ─── Runner ────────────────────────────────────────────────────────────────
async function main() {
  try {
    await setupMongo();
    await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: MONGO_SELECTION_TIMEOUT_MS });

    console.log(`[check-flow] db   ${redactUri(mongoUri)}`);

    // Core phases clean the database; the server then bootstraps the
    // government account against that clean state.
    await phase1Models();
    await phase4CoreLogic();
    await phase4bMergeReconcile();
    await phase7ConcurrentMerge();
    await phase7StatusOwnership();
    await startServer();

    console.log(`[check-flow] api  ${baseUrl || '(core only)'}`);
    if (!CORE_ONLY) {
      await phase2Auth();
      await phase5Routes();
      await phase6Realtime();
      await phase7OwnershipHttp();
      await phase7MineMerged();
      await phase7MustChangePassword();
      await phase7SocketIsolation();
      await phase7GapDedup();
      await phase7SuspendedUser();
    }
  } finally {
    // Always clean up — drops the generated Atlas test database when --atlas.
    await teardown();
  }

  console.log(`\n[check-flow] ${passed} passed, ${failed} failed`);
  if (failed) {
    console.error('[check-flow] failures:');
    for (const f of failures) console.error(`  - ${f}`);
  }
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error('[check-flow] crashed:', err);
  await teardown();
  process.exit(1);
});
