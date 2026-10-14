import dotenv from 'dotenv';

dotenv.config();

const isProd = (process.env.NODE_ENV || 'development') === 'production';

function required(name, fallback) {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function parseBool(value, fallback) {
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function parseNumber(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (Number.isNaN(n)) {
    // eslint-disable-next-line no-console
    console.warn(`[env] ${name}="${raw}" is not a number, using default ${fallback}.`);
    return fallback;
  }
  return n;
}

const jwtSecret = required('JWT_SECRET', 'dev-insecure-secret-change-me');
if (isProd && jwtSecret === 'dev-insecure-secret-change-me') {
  throw new Error('JWT_SECRET must be set to a strong value in production.');
}

// ─── Identity adapter ───────────────────────────────────────────────────────
// 'basic' (default): identityVerified stays false until a manual/external flow
// flips it. 'digilocker': OAuth authorization code + PKCE, scaffolded.
const identityMode = (process.env.IDENTITY_MODE || 'basic').toLowerCase();
if (!['basic', 'digilocker'].includes(identityMode)) {
  throw new Error(`IDENTITY_MODE must be "basic" or "digilocker", got "${identityMode}".`);
}

// DigiLocker credentials are only meaningful in digilocker mode. Env validation
// must NOT require them in basic mode. In digilocker mode a missing credential
// does not crash the server — the routes report 501 until they exist.
const digilocker = {
  clientId: process.env.DIGILOCKER_CLIENT_ID || '',
  clientSecret: process.env.DIGILOCKER_CLIENT_SECRET || '',
  redirectUri: process.env.DIGILOCKER_REDIRECT_URI || '',
  authorizeUrl:
    process.env.DIGILOCKER_AUTHORIZE_URL ||
    'https://uidauth.digilocker.gov.in/digilocker/public/oauth2/authorize',
  tokenUrl:
    process.env.DIGILOCKER_TOKEN_URL ||
    'https://uidauth.digilocker.gov.in/digilocker/public/oauth2/token',
  profileUrl:
    process.env.DIGILOCKER_PROFILE_URL ||
    'https://api.digilocker.gov.in/v2/open/oauth2/user/profile',
};
digilocker.configured = Boolean(
  digilocker.clientId && digilocker.clientSecret && digilocker.redirectUri,
);
if (identityMode === 'digilocker' && !digilocker.configured) {
  // eslint-disable-next-line no-console
  console.warn(
    '[env] IDENTITY_MODE=digilocker but DIGILOCKER_CLIENT_ID / _CLIENT_SECRET / _REDIRECT_URI '
      + 'are incomplete — identity routes will return 501 until they are set.',
  );
}

export const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  isProd,
  port: Number(process.env.PORT || 4000),
  mongoUri: required('MONGO_URI', 'mongodb://127.0.0.1:27017/aidpulse'),
  jwtSecret,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '1h',
  clientOrigin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',

  // How long the driver waits to select a server. Raised for Atlas runs.
  mongoServerSelectionTimeoutMS: parseNumber('MONGO_SERVER_SELECTION_TIMEOUT_MS', 10000),

  // Government bootstrap (server start, only when no government user exists).
  govEmail: process.env.GOV_EMAIL || '',
  govPassword: process.env.GOV_PASSWORD || '',

  // Sweeper / gap scanner tuning.
  staleClaimHours: parseNumber('STALE_CLAIM_HOURS', 4),
  staleSweepMinutes: parseNumber('STALE_SWEEP_MINUTES', 15),
  gapThresholdMinutes: parseNumber('GAP_THRESHOLD_MINUTES', 30),
  gapCellThreshold: parseNumber('GAP_CELL_THRESHOLD', 3),
  gapScanMinutes: parseNumber('GAP_SCAN_MINUTES', 5),

  identityMode,
  digilocker,

  bcryptRounds: parseNumber('BCRYPT_ROUNDS', 12),
};
