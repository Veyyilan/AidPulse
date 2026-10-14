import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { User } from '../models/User.js';
import { env } from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';
import { normalizePhone } from '../utils/phone.js';
import { NEED_TYPES } from '../config/constants.js';
import { disconnectUser } from '../realtime/index.js';

/**
 * Create the government account on server start if and only if none exists.
 * Never overwrites an existing government user, never logs the password.
 */
export async function ensureGovernmentUser() {
  const existing = await User.findOne({ role: 'government' });
  if (existing) return existing;

  if (!env.govEmail || !env.govPassword) {
    // eslint-disable-next-line no-console
    console.warn(
      '[bootstrap] No government user exists and GOV_EMAIL / GOV_PASSWORD are not set. '
        + 'Set them (or run scripts/bootstrap-government.mjs) to enable government access.',
    );
    return null;
  }

  const passwordHash = await bcrypt.hash(env.govPassword, env.bcryptRounds);
  try {
    const gov = await User.create({
      name: 'Government Control',
      email: String(env.govEmail).toLowerCase().trim(),
      passwordHash,
      role: 'government',
      organizationName: 'State Emergency Management',
      mustChangePassword: true,
      identityVerified: false,
    });
    // eslint-disable-next-line no-console
    console.log(`[bootstrap] government account created for ${gov.email} (must change password on first login)`);
    return gov;
  } catch (err) {
    if (err.code === 11000) return User.findOne({ role: 'government' });
    throw err;
  }
}

function generateTempPassword() {
  // 16 chars, URL-safe, guaranteed to include a mix of character classes.
  return `Ap-${crypto.randomBytes(9).toString('base64url')}9!`;
}

/** Normalise + validate the requested NGO capabilities. */
export function normalizeCapabilities(input) {
  const list = Array.isArray(input) ? input : [];
  const cleaned = [...new Set(list.map((c) => String(c ?? '').trim().toLowerCase()))];
  if (cleaned.length === 0) {
    throw ApiError.unprocessable('At least one capability is required', [
      { field: 'capabilities', message: `subset of: ${NEED_TYPES.join(', ')}` },
    ]);
  }
  const invalid = cleaned.filter((c) => !NEED_TYPES.includes(c));
  if (invalid.length) {
    throw ApiError.unprocessable('Invalid capability', [
      { field: 'capabilities', message: `unsupported: ${invalid.join(', ')}` },
    ]);
  }
  return cleaned;
}

/**
 * Provision an NGO (government only). Returns the user plus the generated
 * temporary password to hand to the organisation. mustChangePassword is set.
 */
export async function createNgo({
  name,
  email,
  phone,
  organizationName,
  capabilities,
  password,
}) {
  const caps = normalizeCapabilities(capabilities);

  const cleanEmail = String(email ?? '').toLowerCase().trim();
  if (!cleanEmail) {
    throw ApiError.unprocessable('email is required for NGO accounts', [
      { field: 'email', message: 'required' },
    ]);
  }
  const existing = await User.findOne({ email: cleanEmail });
  if (existing) throw ApiError.conflict('An account with this email already exists');

  let normalizedPhone;
  if (phone) {
    normalizedPhone = normalizePhone(phone);
    if (!normalizedPhone) throw ApiError.unprocessable('Invalid phone number');
    const phoneTaken = await User.findOne({ phone: normalizedPhone });
    if (phoneTaken) throw ApiError.conflict('Phone number already registered');
  }

  const tempPassword = password || generateTempPassword();
  const passwordHash = await bcrypt.hash(tempPassword, env.bcryptRounds);

  const ngo = await User.create({
    name,
    email: cleanEmail,
    ...(normalizedPhone ? { phone: normalizedPhone } : {}),
    passwordHash,
    role: 'ngo',
    capabilities: caps,
    organizationName,
    identityVerified: false,
    mustChangePassword: true,
  });

  return { user: ngo, tempPassword };
}

/** Suspend or restore a user. Suspension also drops any live sockets. */
export async function setSuspended(userId, suspended) {
  const user = await User.findByIdAndUpdate(
    userId,
    { $set: { isSuspended: Boolean(suspended) } },
    { new: true },
  ).select('-passwordHash');
  if (!user) throw ApiError.notFound('User not found');

  // An already-connected socket must not keep receiving events once suspended.
  if (suspended) disconnectUser(user._id);

  return user;
}
