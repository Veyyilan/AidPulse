import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';
import { User } from '../models/User.js';

/**
 * Identity adapter.
 *
 * IDENTITY_MODE=basic (default)
 *   No external verification. Registration leaves `identityVerified=false`.
 *   The DigiLocker routes are behind the flag and return 501 so basic mode is
 *   never broken.
 *
 * IDENTITY_MODE=digilocker
 *   OAuth 2.0 authorization code flow with PKCE (S256). The code verifier and
 *   state are held server-side with a short TTL. Only `identityVerified`, the
 *   verified name, and a hashed DigiLocker reference are ever stored — the
 *   Aadhaar number is never requested or persisted.
 *
 * The DigiLocker endpoints are scaffolded with placeholders. Routes return 501
 * until DIGILOCKER_CLIENT_ID / _CLIENT_SECRET / _REDIRECT_URI are configured.
 */

const PKCE_TTL_MS = 10 * 60 * 1000; // pending authorisations live 10 minutes

/** state -> { verifier, userId, expiresAt } */
const pendingAuth = new Map();

// Opportunistic sweep of expired pending authorisations.
const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [state, entry] of pendingAuth) {
    if (entry.expiresAt <= now) pendingAuth.delete(state);
  }
}, 60 * 1000);
cleanupTimer.unref?.();

function base64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function identityMode() {
  return env.identityMode;
}

export function isDigilockerConfigured() {
  return env.identityMode === 'digilocker' && env.digilocker.configured;
}

function assertDigilocker() {
  if (env.identityMode !== 'digilocker') {
    throw new ApiError(501, 'Identity adapter is in basic mode; DigiLocker is not enabled.');
  }
  if (!env.digilocker.configured) {
    throw new ApiError(501, 'DigiLocker credentials are not configured.');
  }
}

/**
 * Begin the DigiLocker flow for a user. Returns the authorization URL to send
 * the client to. Stores the PKCE verifier + state server-side.
 */
export function startDigilocker(userId) {
  assertDigilocker();

  const verifier = base64url(crypto.randomBytes(32));
  const challenge = base64url(crypto.createHash('sha256').update(verifier).digest());
  const state = base64url(crypto.randomBytes(16));

  pendingAuth.set(state, {
    verifier,
    userId: String(userId),
    expiresAt: Date.now() + PKCE_TTL_MS,
  });

  const url = new URL(env.digilocker.authorizeUrl);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', env.digilocker.clientId);
  url.searchParams.set('redirect_uri', env.digilocker.redirectUri);
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');

  return { url: url.toString(), state, expiresAt: Date.now() + PKCE_TTL_MS };
}

/** sha256 of the DigiLocker reference + server pepper (never the raw ref). */
function hashReference(reference) {
  return crypto
    .createHash('sha256')
    .update(`${env.jwtSecret}:${String(reference)}`)
    .digest('hex');
}

/**
 * Complete the DigiLocker flow: exchange the code, read the profile, and store
 * only the verified flag, verified name, and hashed reference.
 */
export async function completeDigilocker({ code, state }) {
  assertDigilocker();

  const entry = pendingAuth.get(state);
  if (!entry || entry.expiresAt <= Date.now()) {
    pendingAuth.delete(state);
    throw ApiError.badRequest('Invalid or expired identity state');
  }
  pendingAuth.delete(state);

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: String(code),
    code_verifier: entry.verifier,
    client_id: env.digilocker.clientId,
    client_secret: env.digilocker.clientSecret,
    redirect_uri: env.digilocker.redirectUri,
  });

  const tokenRes = await fetch(env.digilocker.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!tokenRes.ok) {
    throw new ApiError(502, `DigiLocker token exchange failed (${tokenRes.status})`);
  }
  const token = await tokenRes.json();

  let profile = {};
  try {
    const profileRes = await fetch(env.digilocker.profileUrl, {
      headers: { Authorization: `Bearer ${token.access_token}` },
    });
    if (profileRes.ok) profile = await profileRes.json();
  } catch {
    profile = {};
  }

  const verifiedName = profile.name || profile.user_name || profile.full_name || null;
  const reference =
    profile.digilockerid || profile.sub || profile.id || token.sub || entry.userId;

  const user = await User.findByIdAndUpdate(
    entry.userId,
    { $set: { identityVerified: true, verifiedName, identityRefHash: hashReference(reference) } },
    { new: true },
  ).select('-passwordHash');
  if (!user) throw ApiError.notFound('User no longer exists');

  return user;
}
