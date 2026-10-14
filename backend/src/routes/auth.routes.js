import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { body } from 'express-validator';
import { User } from '../models/User.js';
import { env } from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { signToken } from '../utils/jwt.js';
import { serializeAuth } from '../utils/serialize.js';
import { handleValidation } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { authLimiter } from '../middleware/rateLimit.js';
import { INDIAN_MOBILE_RE, normalizePhone } from '../utils/phone.js';

const router = Router();

/**
 * POST /api/auth/register
 *
 * Always creates a citizen. Any `role` in the body is ignored. Requires
 * consent=true (stored as consentAt). Phone must be a 10-digit Indian mobile
 * and is stored as +91XXXXXXXXXX.
 */
router.post(
  '/register',
  authLimiter,
  [
    body('name').isString().trim().isLength({ min: 2, max: 120 }),
    body('phone').isString().trim().matches(INDIAN_MOBILE_RE).withMessage('phone must be 10 digits starting 6-9'),
    body('password').isString().isLength({ min: 8, max: 200 }),
    body('consent').custom((v) => v === true || v === 'true').withMessage('consent=true is required'),
    body('email').optional({ nullable: true }).isEmail().normalizeEmail(),
    // `role` is accepted but deliberately ignored — see handler.
    body('role').optional().isString(),
  ],
  handleValidation,
  asyncHandler(async (req, res) => {
    const { name, phone, password, email } = req.body;

    const normalizedPhone = normalizePhone(phone);
    if (!normalizedPhone) throw ApiError.unprocessable('Invalid phone number');

    const existing = await User.findOne({ phone: normalizedPhone });
    if (existing) throw ApiError.conflict('Phone number already registered');

    const passwordHash = await bcrypt.hash(password, env.bcryptRounds);

    const user = await User.create({
      name,
      phone: normalizedPhone,
      // Email is optional and must be omitted (not null) for the sparse index.
      ...(email ? { email } : {}),
      passwordHash,
      role: 'citizen', // registration is citizen-only; body.role is ignored
      consentAt: new Date(),
      identityVerified: false,
    });

    const token = signToken(user);
    res.status(201).json(serializeAuth(user, token));
  }),
);

/**
 * POST /api/auth/login
 *
 * Citizens sign in with `phone`; NGOs and government sign in with `email`.
 * Provide one of the two.
 */
router.post(
  '/login',
  authLimiter,
  [
    body('password').isString().isLength({ min: 1 }),
    body('phone').optional({ nullable: true }).isString(),
    body('email').optional({ nullable: true }).isString(),
    body().custom((_, { req }) => {
      if (!req.body.phone && !req.body.email) {
        throw new Error('provide phone (citizens) or email (ngo/government)');
      }
      return true;
    }),
  ],
  handleValidation,
  asyncHandler(async (req, res) => {
    const { password, phone, email } = req.body;

    let user = null;
    if (phone) {
      const normalizedPhone = normalizePhone(phone);
      if (!normalizedPhone) throw ApiError.unauthorized('Invalid credentials');
      user = await User.findOne({ phone: normalizedPhone }).select('+passwordHash');
    } else {
      user = await User.findOne({ email: String(email).toLowerCase().trim() }).select('+passwordHash');
    }

    if (!user) throw ApiError.unauthorized('Invalid credentials');

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) throw ApiError.unauthorized('Invalid credentials');

    if (user.isSuspended) throw ApiError.unauthorized('Account suspended');

    const token = signToken(user);
    const obj = user.toObject();
    delete obj.passwordHash;
    res.json(serializeAuth(obj, token));
  }),
);

/**
 * GET /api/auth/me — the role always comes from the database, never the token.
 */
router.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(serializeAuth(req.user, req.token));
  }),
);

/**
 * POST /api/auth/change-password — clears mustChangePassword. Used by
 * government-provisioned NGO accounts on first login.
 */
router.post(
  '/change-password',
  requireAuth,
  authLimiter,
  [
    body('currentPassword').isString().isLength({ min: 1 }),
    body('newPassword').isString().isLength({ min: 8, max: 200 }),
  ],
  handleValidation,
  asyncHandler(async (req, res) => {
    const user = await User.findById(req.user._id).select('+passwordHash');
    if (!user) throw ApiError.unauthorized('User no longer exists');

    const ok = await bcrypt.compare(req.body.currentPassword, user.passwordHash);
    if (!ok) throw ApiError.unauthorized('Current password is incorrect');

    // A new password identical to the current/temporary one is not a change.
    const reuse = await bcrypt.compare(req.body.newPassword, user.passwordHash);
    if (reuse) {
      throw ApiError.unprocessable('New password must differ from the current password', [
        { field: 'newPassword', message: 'identical to the current password' },
      ]);
    }

    user.passwordHash = await bcrypt.hash(req.body.newPassword, env.bcryptRounds);
    user.mustChangePassword = false;
    await user.save();

    res.json(serializeAuth(user, req.token));
  }),
);

export default router;
