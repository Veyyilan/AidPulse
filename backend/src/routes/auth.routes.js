import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { body } from 'express-validator';
import { User } from '../models/User.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { signToken } from '../utils/jwt.js';
import { serializeAuth } from '../utils/serialize.js';
import { handleValidation } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { authLimiter } from '../middleware/rateLimit.js';

const router = Router();

const BCRYPT_ROUNDS = 12;
// Roles a user may self-select at registration. `admin` can NEVER be set here.
const SELF_SERVICE_ROLES = ['citizen', 'ngo', 'government'];

router.post(
  '/register',
  authLimiter,
  [
    body('name').isString().trim().isLength({ min: 2, max: 120 }),
    body('email').isEmail().normalizeEmail(),
    body('password').isString().isLength({ min: 8, max: 200 }),
    body('role').optional().isString(),
    body('phone').optional({ nullable: true }).isString().trim().isLength({ max: 30 }),
    body('organizationName')
      .optional({ nullable: true })
      .isString()
      .trim()
      .isLength({ max: 200 }),
  ],
  handleValidation,
  asyncHandler(async (req, res) => {
    const { name, email, password, phone, organizationName } = req.body;

    // Sanitise the requested role: never trust privilege from input.
    let role = 'citizen';
    if (req.body.role !== undefined && req.body.role !== null && req.body.role !== '') {
      const requested = String(req.body.role).toLowerCase();
      if (requested === 'admin') {
        throw ApiError.forbidden('admin role cannot be self-assigned');
      }
      if (!SELF_SERVICE_ROLES.includes(requested)) {
        throw ApiError.unprocessable('Invalid role', [
          { field: 'role', message: `role must be one of: ${SELF_SERVICE_ROLES.join(', ')}` },
        ]);
      }
      role = requested;
    }

    const existing = await User.findOne({ email });
    if (existing) throw ApiError.conflict('Email already registered');

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const user = await User.create({
      name,
      email,
      passwordHash,
      role,
      phone: phone ?? null,
      organizationName: organizationName ?? null,
    });

    const token = signToken(user);
    res.status(201).json(serializeAuth(user, token));
  }),
);

router.post(
  '/login',
  authLimiter,
  [body('email').isEmail().normalizeEmail(), body('password').isString().isLength({ min: 1 })],
  handleValidation,
  asyncHandler(async (req, res) => {
    const { email, password } = req.body;

    const user = await User.findOne({ email }).select('+passwordHash');
    if (!user) throw ApiError.unauthorized('Invalid credentials');

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) throw ApiError.unauthorized('Invalid credentials');

    if (user.isSuspended) throw ApiError.forbidden('Account suspended');

    const token = signToken(user);
    const obj = user.toObject();
    delete obj.passwordHash;
    res.json(serializeAuth(obj, token));
  }),
);

router.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    // Return the token too, so the frontend can refresh its stored session.
    res.json(serializeAuth(req.user, req.token));
  }),
);

export default router;
