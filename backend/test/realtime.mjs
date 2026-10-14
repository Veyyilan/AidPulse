/**
 * Realtime + maintenance smoke test.
 *
 * Verifies:
 *  - Socket.IO handshake auth (bad token rejected, good token accepted)
 *  - role-based room membership (ngo -> ngo-room, citizen -> user room only)
 *  - `report:new` and `report:claimed` fan-out to the operational rooms
 *  - the stale-claim sweeper reverts idle claims and writes a force_released audit
 *
 * Run: npm run test:realtime
 */
import { MongoMemoryServer } from 'mongodb-memory-server';
import { io } from 'socket.io-client';
import bcrypt from 'bcryptjs';

const PORT = 4445;
const HTTP = `http://localhost:${PORT}`;
const BASE = `${HTTP}/api`;

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

function once(socket, event, timeoutMs = 6000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), timeoutMs);
    socket.once(event, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

async function main() {
  console.log('[realtime] starting in-memory MongoDB…');
  const mongod = await MongoMemoryServer.create();

  process.env.MONGO_URI = mongod.getUri('aidpulse_realtime');
  process.env.JWT_SECRET = 'realtime-test-secret';
  process.env.PORT = String(PORT);
  process.env.CLIENT_ORIGIN = 'http://localhost:5173';
  process.env.DEPLOYMENT_REGION_BOUNDS = '6.30,6.70,3.10,3.60';
  process.env.STALE_CLAIM_HOURS = '4';
  process.env.NODE_ENV = 'test';

  console.log('[realtime] booting server…');
  await import('../src/index.js');
  await waitForServer();

  const { User } = await import('../src/models/User.js');
  const { Report } = await import('../src/models/Report.js');
  const { runStaleClaimSweep } = await import('../src/jobs/staleClaims.js');
  const { ClaimAudit } = await import('../src/models/ClaimAudit.js');

  // ── Fixtures ────────────────────────────────────────────────────────────────
  const citizen = await api('POST', '/auth/register', {
    body: { name: 'RT Citizen', email: 'rt.citizen@test.io', password: 'Password123!', role: 'citizen' },
  });
  // Registration is citizen-only; create NGO directly in DB
  await User.create({
    name: 'RT NGO',
    email: 'rt.ngo@test.io',
    role: 'ngo',
    passwordHash: await bcrypt.hash('Password123!', 12),
  });
  await User.create({
    name: 'RT Admin',
    email: 'rt.admin@test.io',
    role: 'admin',
    passwordHash: await bcrypt.hash('Password123!', 12),
  });
  const ngoLogin = await api('POST', '/auth/login', { body: { email: 'rt.ngo@test.io', password: 'Password123!' } });
  const admin = await api('POST', '/auth/login', { body: { email: 'rt.admin@test.io', password: 'Password123!' } });

  const citizenToken = citizen.body.token;
  const ngoToken = ngoLogin.body.token;

  // ── Socket handshake auth ───────────────────────────────────────────────────
  console.log('\nsocket auth');
  const badSocket = io(HTTP, { auth: { token: 'not-a-real-token' }, transports: ['websocket'], reconnection: false });
  const badErr = await new Promise((resolve) => {
    badSocket.on('connect_error', (e) => resolve(e.message));
    badSocket.on('connect', () => resolve('connected-unexpectedly'));
    setTimeout(() => resolve('timeout'), 4000);
  });
  check('socket rejects invalid token', badErr === 'unauthorized', badErr);
  badSocket.close();

  const ngoSocket = io(HTTP, { auth: { token: ngoToken }, transports: ['websocket'], reconnection: false });
  const ngoConnected = await new Promise((resolve) => {
    ngoSocket.on('connected', resolve);
    ngoSocket.on('connect_error', (e) => resolve({ error: e.message }));
    setTimeout(() => resolve(null), 4000);
  });
  check('ngo socket authenticates + joins ngo-room', ngoConnected?.room === 'ngo-room', ngoConnected);

  const citizenSocket = io(HTTP, { auth: { token: citizenToken }, transports: ['websocket'], reconnection: false });
  const citizenConnected = await new Promise((resolve) => {
    citizenSocket.on('connected', resolve);
    setTimeout(() => resolve(null), 4000);
  });
  check('citizen socket authenticates without a role room', citizenConnected?.room === null, citizenConnected);

  // ── report:new fan-out ──────────────────────────────────────────────────────
  console.log('\nreport:new event');
  const newEventPromise = once(ngoSocket, 'report:new');
  const created = await api('POST', '/reports', {
    token: citizenToken,
    body: { needType: 'food', description: 'Families stranded without food for three days.', lat: 6.452, lng: 3.38 },
  });
  const newEvent = await newEventPromise;
  check('ngo receives report:new', newEvent?.id === created.body.id, { got: newEvent?.id, want: created.body.id });

  // ── report:claimed fan-out ──────────────────────────────────────────────────
  console.log('\nreport:claimed event');
  const claimedEventPromise = once(ngoSocket, 'report:claimed');
  await api('PATCH', `/reports/${created.body.id}/claim`, { token: ngoToken });
  const claimedEvent = await claimedEventPromise;
  check('ngo receives report:claimed', claimedEvent?.id === created.body.id && claimedEvent?.status === 'claimed', claimedEvent?.status);

  // ── Stale-claim sweeper ─────────────────────────────────────────────────────
  console.log('\nstale-claim sweeper');
  const stale = await Report.create({
    reportedBy: citizen.body.id,
    needType: 'rescue',
    description: 'Someone trapped, claim left idle beyond the threshold.',
    location: { type: 'Point', coordinates: [3.39, 6.46] },
    status: 'claimed',
    claimedBy: ngoLogin.body.id,
    claimedAt: new Date(Date.now() - 6 * 3600 * 1000), // 6h ago (> 4h threshold)
  });

  const releasedPromise = once(ngoSocket, 'report:released');
  const count = await runStaleClaimSweep();
  check('sweep force-released the stale claim', count >= 1, count);

  const releasedEvent = await releasedPromise.catch(() => null);
  check('sweeper emits report:released', releasedEvent?.id === String(stale._id) && releasedEvent?.status === 'pending', releasedEvent?.status);

  const after = await Report.findById(stale._id);
  check('stale report is back to pending + unclaimed', after.status === 'pending' && after.claimedBy === null, {
    status: after.status,
    claimedBy: after.claimedBy,
  });

  const audits = await ClaimAudit.find({ reportId: stale._id });
  check('sweeper wrote a force_released audit row', audits.some((a) => a.action === 'force_released'), audits.map((a) => a.action));

  // ── Append-only enforcement ─────────────────────────────────────────────────
  console.log('\nappend-only audit');
  let mutationBlocked = false;
  try {
    await ClaimAudit.updateOne({ reportId: stale._id }, { $set: { action: 'claimed' } });
  } catch {
    mutationBlocked = true;
  }
  check('audit collection rejects updates', mutationBlocked);

  ngoSocket.close();
  citizenSocket.close();

  console.log(`\n[realtime] ${passed} passed, ${failed} failed`);
  await mongod.stop();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('[realtime] crashed:', err);
  process.exit(1);
});
