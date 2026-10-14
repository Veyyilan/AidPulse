/**
 * End-to-end smoke test.
 *
 * Boots an in-memory MongoDB, starts the real HTTP server, and exercises the
 * critical paths: auth, report creation + duplicate detection, atomic claiming
 * (including the 409 race), the append-only audit trail, gaps/duplicates/stats,
 * nearby search, the SMS webhook, and user suspension.
 *
 * Run: npm run test:smoke
 */
import { MongoMemoryServer } from 'mongodb-memory-server';

const PORT = 4444;
const BASE = `http://localhost:${PORT}/api`;

let passed = 0;
let failed = 0;

function check(name, condition, extra) {
  if (condition) {
    passed += 1;
    console.log(`  \u2713 ${name}`);
  } else {
    failed += 1;
    console.error(`  \u2717 ${name}${extra ? ` -> ${JSON.stringify(extra)}` : ''}`);
  }
}

async function api(method, path, { token, body, headers } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { status: res.status, body: json };
}

async function waitForServer(timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${BASE}/health`);
      if (res.ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('server did not come up in time');
}

async function main() {
  console.log('[smoke] starting in-memory MongoDB…');
  const mongod = await MongoMemoryServer.create();

  process.env.MONGO_URI = mongod.getUri('aidpulse_smoke');
  process.env.JWT_SECRET = 'smoke-test-secret';
  process.env.PORT = String(PORT);
  process.env.CLIENT_ORIGIN = 'http://localhost:5173';
  process.env.DEPLOYMENT_REGION_BOUNDS = '6.30,6.70,3.10,3.60'; // Lagos region
  process.env.SMS_API_KEY = 'smoke-sms-key';
  process.env.NODE_ENV = 'test';

  console.log('[smoke] booting server…');
  await import('../src/index.js');
  await waitForServer();

  // Create an admin directly in the DB (admins cannot self-register by design).
  const bcrypt = (await import('bcryptjs')).default;
  const { User } = await import('../src/models/User.js');
  await User.create({
    name: 'Smoke Admin',
    email: 'admin@test.io',
    role: 'admin',
    passwordHash: await bcrypt.hash('Password123!', 12),
  });

  // ── Health ────────────────────────────────────────────────────────────────
  console.log('\nhealth');
  const health = await api('GET', '/health');
  check('health returns ok', health.status === 200 && health.body.status === 'ok', health.body);

  // ── Auth ──────────────────────────────────────────────────────────────────
  console.log('\nauth');
  const citizenReg = await api('POST', '/auth/register', {
    body: { name: 'Test Citizen', email: 'citizen@test.io', password: 'Password123!', role: 'citizen' },
  });
  check('register citizen -> 201 + token', citizenReg.status === 201 && !!citizenReg.body.token, citizenReg.body);
  check('register defaults role citizen', citizenReg.body.role === 'citizen', citizenReg.body.role);
  const citizenToken = citizenReg.body.token;

  const adminReg = await api('POST', '/auth/register', {
    body: { name: 'Test Admin', email: 'admin@test.io', password: 'Password123!', role: 'admin' },
  });
  check('admin role cannot be self-assigned', adminReg.status === 403, adminReg.body);

  // Create an admin directly via a second registration with allowed role, then
  // promote through the DB is out of scope — instead register a gov user and
  // verify role plumbing using the admin seeded below.
  await api('POST', '/auth/register', {
    body: { name: 'NGO One', email: 'ngo1@test.io', password: 'Password123!', role: 'ngo', organizationName: 'Red Cross' },
  });
  await api('POST', '/auth/register', {
    body: { name: 'NGO Two', email: 'ngo2@test.io', password: 'Password123!', role: 'ngo' },
  });
  await api('POST', '/auth/register', {
    body: { name: 'Gov User', email: 'gov@test.io', password: 'Password123!', role: 'government' },
  });

  const login = await api('POST', '/auth/login', {
    body: { email: 'ngo1@test.io', password: 'Password123!' },
  });
  check('login -> token', login.status === 200 && !!login.body.token, login.body);
  const ngo1Token = login.body.token;

  const login2 = await api('POST', '/auth/login', {
    body: { email: 'ngo2@test.io', password: 'Password123!' },
  });
  const ngo2Token = login2.body.token;

  const govLogin = await api('POST', '/auth/login', {
    body: { email: 'gov@test.io', password: 'Password123!' },
  });
  const govToken = govLogin.body.token;

  const adminLogin = await api('POST', '/auth/login', {
    body: { email: 'admin@test.io', password: 'Password123!' },
  });
  check('admin login -> token', adminLogin.status === 200 && adminLogin.body.role === 'admin', adminLogin.body);
  const adminToken = adminLogin.body.token;

  const me = await api('GET', '/auth/me', { token: citizenToken });
  check('GET /auth/me returns user + token', me.status === 200 && me.body.email === 'citizen@test.io' && !!me.body.token);

  const badLogin = await api('POST', '/auth/login', {
    body: { email: 'ngo1@test.io', password: 'wrong-password' },
  });
  check('bad password -> 401', badLogin.status === 401);

  // ── Reports: create ─────────────────────────────────────────────────────────
  console.log('\nreports');
  const r1 = await api('POST', '/reports', {
    token: citizenToken,
    body: { needType: 'Medical', description: 'Elderly resident needs insulin urgently.', lat: 6.455, lng: 3.3841, accuracy: 12 },
  });
  check('citizen can create report -> 201', r1.status === 201, r1.body);
  check('needType normalised to label "Medical"', r1.body.needType === 'Medical', r1.body?.needType);
  check('coords serialised as lat/lng numbers', r1.body.lat === 6.455 && r1.body.lng === 3.3841, r1.body);
  check('accuracy alias mapped', r1.body.accuracy === 12, r1.body?.accuracy);

  // Duplicate: same need type, ~60m away, within the 2h window.
  const r2 = await api('POST', '/reports', {
    token: citizenToken,
    body: { needType: 'medical', description: 'Another resident nearby also needs insulin.', lat: 6.4555, lng: 3.3845 },
  });
  check('duplicate report created', r2.status === 201, r2.body);
  check('duplicate links to original', r2.body.duplicateOf === r1.body.id, { got: r2.body.duplicateOf, want: r1.body.id });

  // Out-of-region rejection.
  const farReport = await api('POST', '/reports', {
    token: citizenToken,
    body: { needType: 'food', description: 'Far away report that should be rejected', lat: 51.5, lng: -0.12 },
  });
  check('out-of-region report rejected -> 422', farReport.status === 422, farReport.body);

  const mine = await api('GET', '/reports/mine', { token: citizenToken });
  check('GET /reports/mine returns 2', mine.status === 200 && mine.body.length === 2, mine.body?.length);

  // ── Claim race ──────────────────────────────────────────────────────────────
  console.log('\natomic claim');
  const claim1 = await api('PATCH', `/reports/${r1.body.id}/claim`, { token: ngo1Token });
  check('ngo1 claim -> 200 + claimed', claim1.status === 200 && claim1.body.status === 'claimed', claim1.body);
  check('claimedBy set to ngo1', !!claim1.body.claimedBy);

  const claim2 = await api('PATCH', `/reports/${r1.body.id}/claim`, { token: ngo2Token });
  check('ngo2 second claim -> 409', claim2.status === 409, claim2.body);

  const citizenClaim = await api('PATCH', `/reports/${r1.body.id}/claim`, { token: citizenToken });
  check('citizen cannot claim -> 403', citizenClaim.status === 403, citizenClaim.body);

  // Concurrent claims on a fresh report — exactly one must win.
  const r3 = await api('POST', '/reports', {
    token: citizenToken,
    body: { needType: 'shelter', description: 'Flood destroyed three homes overnight.', lat: 6.448, lng: 3.377 },
  });
  const [c1, c2] = await Promise.all([
    api('PATCH', `/reports/${r3.body.id}/claim`, { token: ngo1Token }),
    api('PATCH', `/reports/${r3.body.id}/claim`, { token: ngo2Token }),
  ]);
  const wins = [c1, c2].filter((r) => r.status === 200).length;
  const conflicts = [c1, c2].filter((r) => r.status === 409).length;
  check('exactly one concurrent claim wins', wins === 1 && conflicts === 1, { c1: c1.status, c2: c2.status });

  // ── Audit trail (append-only) ───────────────────────────────────────────────
  console.log('\naudit (admin)');
  const auditDenied = await api('GET', `/admin/audit/${r1.body.id}`, { token: ngo1Token });
  check('non-admin cannot read audit -> 403', auditDenied.status === 403);

  const audit = await api('GET', `/admin/audit/${r1.body.id}`, { token: adminToken });
  check('admin audit trail has claimed row', audit.status === 200 && audit.body.some((a) => a.action === 'claimed'), audit.body);

  // ── Release + status ────────────────────────────────────────────────────────
  console.log('\nrelease + status');
  const release = await api('PATCH', `/reports/${r1.body.id}/release`, { token: ngo1Token });
  check('ngo1 release -> 200 pending', release.status === 200 && release.body.status === 'pending', release.body);

  const statusUpd = await api('PATCH', `/reports/${r1.body.id}/status`, { token: govToken, body: { status: 'resolved' } });
  check('gov resolves report -> resolved', statusUpd.status === 200 && statusUpd.body.status === 'resolved', statusUpd.body);

  const relAgain = await api('PATCH', `/reports/${r1.body.id}/release`, { token: ngo1Token });
  check('release non-claimed -> 409', relAgain.status === 409, relAgain.body);

  const fullAudit = await api('GET', `/admin/audit/${r1.body.id}`, { token: adminToken });
  const actions = (fullAudit.body || []).map((a) => a.action);
  check(
    'audit trail captured claimed + released + resolved',
    actions.includes('claimed') && actions.includes('released') && actions.includes('resolved'),
    actions,
  );

  // ── Nearby ──────────────────────────────────────────────────────────────────
  console.log('\nnearby');
  const nearby = await api('GET', '/reports/nearby?lat=6.455&lng=3.3841', { token: ngo1Token });
  check('nearby returns reports with distance', nearby.status === 200 && nearby.body.length > 0 && typeof nearby.body[0].distance === 'number', nearby.body?.[0]);
  const citizenNearby = await api('GET', '/reports/nearby?lat=6.455&lng=3.3841', { token: citizenToken });
  check('citizen forbidden from nearby -> 403', citizenNearby.status === 403);

  // ── List with filters ───────────────────────────────────────────────────────
  const filtered = await api('GET', '/reports?status=pending&needType=medical', { token: govToken });
  check('filtered list respects params', filtered.status === 200 && filtered.body.every((r) => r.status === 'pending' && r.needType === 'Medical'), filtered.body);

  // ── Stats / gaps / duplicates ───────────────────────────────────────────────
  console.log('\nstats');
  const overview = await api('GET', '/stats/overview', { token: govToken });
  check('stats/overview shape', overview.status === 200 && typeof overview.body.totalReports === 'number' && typeof overview.body.coverageGaps === 'number', overview.body);

  const gaps = await api('GET', '/stats/gaps', { token: govToken });
  check('stats/gaps returns array', gaps.status === 200 && Array.isArray(gaps.body), gaps.body);

  const clusters = await api('GET', '/stats/clusters', { token: govToken });
  check('stats/clusters returns duplicate cluster', clusters.status === 200 && Array.isArray(clusters.body) && clusters.body.length >= 1, clusters.body);

  // ── Users + suspend ─────────────────────────────────────────────────────────
  console.log('\nadmin users');
  const usersListDenied = await api('GET', '/users', { token: govToken });
  check('non-admin cannot list users -> 403', usersListDenied.status === 403);

  const usersList = await api('GET', '/users', { token: adminToken });
  check('admin lists users with report counts', usersList.status === 200 && usersList.body.every((u) => typeof u.reports === 'number'), usersList.body?.length);

  const ngo2User = usersList.body.find((u) => u.email === 'ngo2@test.io');
  const suspend = await api('POST', `/users/${ngo2User.id}/suspend`, { token: adminToken });
  check('suspend user -> status suspended', suspend.status === 200 && suspend.body.status === 'suspended', suspend.body);

  const suspendedLogin = await api('POST', '/auth/login', {
    body: { email: 'ngo2@test.io', password: 'Password123!' },
  });
  check('suspended user cannot log in -> 403', suspendedLogin.status === 403, suspendedLogin.body);

  const restore = await api('POST', `/users/${ngo2User.id}/restore`, { token: adminToken });
  check('restore user -> status active', restore.status === 200 && restore.body.status === 'active', restore.body);

  const selfSuspend = await api('POST', `/users/${adminLogin.body.id}/suspend`, { token: adminToken });
  check('admin cannot suspend self -> 400', selfSuspend.status === 400, selfSuspend.body);

  // ── SMS webhook ─────────────────────────────────────────────────────────────
  console.log('\nsms');
  const smsNoKey = await api('POST', '/sms/inbound', { body: { text: 'FOOD, 12 Broad Street' } });
  check('sms without api key -> 401', smsNoKey.status === 401);

  const sms = await api('POST', '/sms/inbound', {
    headers: { 'x-api-key': 'smoke-sms-key' },
    body: { text: 'WATER, borehole broken near the market, 6.4610, 3.3920' },
  });
  check('sms parsed -> 201 source sms', sms.status === 201 && sms.body.source === 'sms', sms.body);
  check('sms needType parsed as Water', sms.body.needType === 'Water', sms.body?.needType);

  const smsBad = await api('POST', '/sms/inbound', {
    headers: { 'x-api-key': 'smoke-sms-key' },
    body: { text: 'gibberish without a need type' },
  });
  check('unparseable sms -> 422', smsBad.status === 422, smsBad.body);

  // ── Validation ──────────────────────────────────────────────────────────────
  console.log('\nvalidation');
  const shortDesc = await api('POST', '/reports', {
    token: citizenToken,
    body: { needType: 'food', description: 'short', lat: 6.45, lng: 3.38 },
  });
  check('description too short -> 422', shortDesc.status === 422, shortDesc.body);

  const badNeed = await api('POST', '/reports', {
    token: citizenToken,
    body: { needType: 'aliens', description: 'A perfectly valid length description.', lat: 6.45, lng: 3.38 },
  });
  check('invalid needType -> 422', badNeed.status === 422, badNeed.body);

  const noAuth = await api('POST', '/reports', {
    body: { needType: 'food', description: 'No token should not work here.', lat: 6.45, lng: 3.38 },
  });
  check('no token -> 401', noAuth.status === 401, noAuth.body);

  // ── Summary ─────────────────────────────────────────────────────────────────
  console.log(`\n[smoke] ${passed} passed, ${failed} failed`);
  await mongod.stop();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('[smoke] crashed:', err);
  process.exit(1);
});
