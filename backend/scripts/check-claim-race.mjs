/**
 * Live-backend verification for Steps 2–3. Run against a running API.
 *
 * Exercises the documented manual flow end-to-end using the seeded demo
 * accounts:
 *   Step 2 — the atomic claim:
 *     - log in as the citizen and as two NGOs
 *     - create a report as the citizen
 *     - claim it as NGO #1            -> must succeed (200)
 *     - claim it again as NGO #1      -> must be refused (409)
 *     - claim it as NGO #2            -> must be refused (409)
 *     - two NGOs claim a fresh report at the same instant -> exactly one wins
 *   Step 3 — the hardening items:
 *     - per-user idempotency: same user + same clientId returns the original
 *       report (200) with no duplicate row; a *different* user reusing that
 *       clientId gets a brand-new report and never the first user's data
 *     - `water` works end to end (label, raw value, lowercase filter)
 *     - `/auth/me` reports the role from the database, not from the token
 *
 * Usage:  node scripts/check-claim-race.mjs
 * Env:    BASE_URL   (default http://localhost:4000/api)
 *         MONGO_URI  (default mongodb://127.0.0.1:27017/aidpulse; only used by
 *                     the /auth/me check to promote a user's role directly)
 */
const BASE = process.env.BASE_URL || 'http://localhost:4000/api';
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/aidpulse';

let passed = 0;
let failed = 0;

function check(name, condition, extra) {
  if (condition) {
    passed += 1;
    console.log(`  \u2713 ${name}`);
  } else {
    failed += 1;
    console.error(`  \u2717 ${name}${extra !== undefined ? ` -> ${JSON.stringify(extra)}` : ''}`);
  }
}

async function api(method, path, { token, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
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

/** Decode a JWT payload without verifying it (test-only inspection). */
function decodeJwt(token) {
  const part = String(token || '').split('.')[1] || '';
  const padded = part.replace(/-/g, '+').replace(/_/g, '/');
  return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
}

async function waitForServer(timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${BASE}/health`);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('server did not come up in time');
}

async function login(email, password) {
  const res = await api('POST', '/auth/login', { body: { email, password } });
  if (res.status !== 200 || !res.body?.token) {
    throw new Error(`login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.token;
}

/** Build a valid report body, allowing a unique location per call. */
function reportBody(overrides = {}) {
  return {
    needType: 'Medical',
    description: 'Flow check: household needs assistance within 24 hours.',
    lat: 6.455,
    lng: 3.3841,
    accuracy: 10,
    ...overrides,
  };
}

async function main() {
  console.log(`[step3] target ${BASE}`);
  await waitForServer();

  console.log('\nstep 1 — log in with the seeded accounts');
  const citizen = await login('citizen@aidpulse.local', 'Citizen123!');
  const ngo1 = await login('ngo1@aidpulse.local', 'Volunteer123!');
  const ngo2 = await login('ngo2@aidpulse.local', 'Volunteer123!');
  check('citizen login -> token', !!citizen);
  check('ngo #1 login -> token', !!ngo1);
  check('ngo #2 login -> token', !!ngo2);

  console.log('\nstep 2 — citizen creates a report');
  const created = await api('POST', '/reports', {
    token: citizen,
    body: reportBody({
      needType: 'Medical',
      description: 'Step 2 check: household needs insulin within 24 hours.',
    }),
  });
  check('create report -> 201', created.status === 201, created.body);
  const reportId = created.body?.id;

  console.log('\nstep 3 — NGO #1 claims it');
  const claim1 = await api('PATCH', `/reports/${reportId}/claim`, { token: ngo1 });
  check('claim -> 200 claimed', claim1.status === 200 && claim1.body.status === 'claimed', claim1.body);

  console.log('\nstep 4 — the 409 (core feature)');
  const claimAgain = await api('PATCH', `/reports/${reportId}/claim`, { token: ngo1 });
  check('same NGO re-claim -> 409', claimAgain.status === 409, claimAgain.body);

  const claimOther = await api('PATCH', `/reports/${reportId}/claim`, { token: ngo2 });
  check('other NGO claim -> 409', claimOther.status === 409, claimOther.body);

  console.log('\nstep 5 — concurrent race on a fresh report');
  const fresh = await api('POST', '/reports', {
    token: citizen,
    body: reportBody({
      needType: 'Water',
      description: 'Step 2 check: borehole broken, families without clean water.',
      lat: 6.461,
      lng: 3.392,
    }),
  });
  const [a, b] = await Promise.all([
    api('PATCH', `/reports/${fresh.body.id}/claim`, { token: ngo1 }),
    api('PATCH', `/reports/${fresh.body.id}/claim`, { token: ngo2 }),
  ]);
  const wins = [a, b].filter((r) => r.status === 200).length;
  const conflicts = [a, b].filter((r) => r.status === 409).length;
  check('exactly one wins, one gets 409', wins === 1 && conflicts === 1, { a: a.status, b: b.status });

  // ─── Step 3, item 2: per-user idempotency ─────────────────────────────────
  console.log('\nstep 6 — report creation is idempotent per user (clientId)');
  const mineBefore = (await api('GET', '/reports/mine', { token: citizen })).body?.length ?? 0;

  const clientId = `dup-${Date.now()}`;
  const first = await api('POST', '/reports', {
    token: citizen,
    body: reportBody({
      needType: 'Water',
      description: 'Idempotency check: this report must be created exactly once.',
      lat: 6.4701,
      lng: 3.4007,
      clientId,
    }),
  });
  check('first create with clientId -> 201', first.status === 201, first.body);

  const retry = await api('POST', '/reports', {
    token: citizen,
    body: reportBody({
      needType: 'Water',
      description: 'Idempotency check: retried submission (offline reconnect).',
      lat: 6.4701,
      lng: 3.4007,
      clientId,
    }),
  });
  check('same user + same clientId -> 200 (not 201)', retry.status === 200, retry.body);
  check('retry returns the original report id', retry.body?.id === first.body?.id, {
    first: first.body?.id,
    retry: retry.body?.id,
  });

  const mineAfter = (await api('GET', '/reports/mine', { token: citizen })).body?.length ?? 0;
  check('no duplicate row was created (+1 only)', mineAfter === mineBefore + 1, {
    mineBefore,
    mineAfter,
  });

  // Two simultaneous retries of the same key must still collapse to one row.
  const raceId = `dup-race-${Date.now()}`;
  const [c1, c2] = await Promise.all([
    api('POST', '/reports', {
      token: citizen,
      body: reportBody({ description: 'Concurrent idempotency A.', clientId: raceId }),
    }),
    api('POST', '/reports', {
      token: citizen,
      body: reportBody({ description: 'Concurrent idempotency B.', clientId: raceId }),
    }),
  ]);
  check('concurrent same clientId -> exactly one 201', [c1, c2].filter((r) => r.status === 201).length === 1, {
    c1: c1.status,
    c2: c2.status,
  });
  check('concurrent same clientId -> exactly one 200', [c1, c2].filter((r) => r.status === 200).length === 1, {
    c1: c1.status,
    c2: c2.status,
  });

  // A *different* user reusing that clientId must get a brand-new report.
  const otherEmail = `idem-other-${Date.now()}@aidpulse.local`;
  const otherReg = await api('POST', '/auth/register', {
    body: { name: 'Idempotency Other', email: otherEmail, password: 'OtherUser123!' },
  });
  check('register a second citizen -> 201', otherReg.status === 201, otherReg.body);
  const otherToken = otherReg.body?.token;

  const other = await api('POST', '/reports', {
    token: otherToken,
    body: reportBody({
      needType: 'Water',
      description: 'Idempotency check: a different user reuses the same clientId.',
      lat: 6.4701,
      lng: 3.4007,
      clientId,
    }),
  });
  check('different user + same clientId -> 201 (new report)', other.status === 201, other.body);
  check(
    'different user does NOT receive the first user\u2019s report',
    other.body?.id !== first.body?.id,
    { first: first.body?.id, other: other.body?.id },
  );
  check(
    'the new report is owned by the second user',
    other.body?.reportedBy === otherReg.body?.id,
    { reportedBy: other.body?.reportedBy, expected: otherReg.body?.id },
  );

  // ─── Step 3, item 3: water end to end ─────────────────────────────────────
  console.log('\nstep 7 — water need type end to end');
  const water = await api('POST', '/reports', {
    token: citizen,
    body: reportBody({
      needType: 'Water',
      description: 'Water check: main borehole failed, 40 households affected.',
      lat: 6.4801,
      lng: 3.4102,
      accuracy: 8,
    }),
  });
  check('water report -> 201 with label "Water"', water.status === 201 && water.body?.needType === 'Water', water.body);
  check('water needTypeRaw is lowercase "water"', water.body?.needTypeRaw === 'water', water.body);

  const waterFeed = await api('GET', '/reports?needType=water&limit=200', { token: ngo1 });
  check(
    'lowercase water filter returns the water report',
    waterFeed.status === 200 &&
      Array.isArray(waterFeed.body) &&
      waterFeed.body.some((r) => r.id === water.body?.id),
    { status: waterFeed.status },
  );

  // ─── Step 3, item 1: /auth/me role comes from the database ────────────────
  console.log('\nstep 8 — /auth/me returns the role from the database, not the token');
  const roleEmail = `role-${Date.now()}@aidpulse.local`;
  const roleReg = await api('POST', '/auth/register', {
    body: { name: 'Role Check', email: roleEmail, password: 'RoleCheck123!', role: 'citizen' },
  });
  check('register a citizen -> 201', roleReg.status === 201, roleReg.body);
  const roleToken = roleReg.body?.token;
  check('token payload claims citizen', decodeJwt(roleToken).role === 'citizen', decodeJwt(roleToken));

  // Change the role in the database only; the already-issued token is untouched.
  try {
    const mongoose = (await import('mongoose')).default;
    await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 5000 });
    await mongoose.connection
      .collection('users')
      .updateOne({ email: roleEmail }, { $set: { role: 'government' } });
    await mongoose.disconnect();
    check('database role promoted to government', true);
  } catch (err) {
    check('database role promoted to government', false, err.message);
  }

  const me = await api('GET', '/auth/me', { token: roleToken });
  check(
    '/auth/me reports the database role (government)',
    me.status === 200 && me.body?.role === 'government',
    me.body,
  );
  check('the token itself still claims citizen (proves the source)', decodeJwt(roleToken).role === 'citizen');

  console.log(`\n[step3] ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('[step3] crashed:', err.message);
  process.exit(1);
});
