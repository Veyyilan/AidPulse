import { Router } from 'express';
import { query } from 'express-validator';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { handleValidation } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/roles.js';
import { env } from '../config/env.js';
import { serializeUser } from '../utils/serialize.js';
import {
  identityMode,
  isDigilockerConfigured,
  startDigilocker,
  completeDigilocker,
} from '../services/identityService.js';

const router = Router();

// GET /api/identity/mode — which adapter is active (no secrets exposed).
router.get('/mode', (_req, res) => {
  res.json({
    mode: identityMode(),
    digilockerConfigured: isDigilockerConfigured(),
  });
});

/**
 * GET /api/identity/digilocker/start — begin PKCE authorization for the
 * current user. 501 in basic mode or when credentials are absent.
 */
router.get(
  '/digilocker/start',
  requireAuth,
  requireRole('citizen', 'ngo', 'government'),
  asyncHandler(async (req, res) => {
    const result = startDigilocker(req.user._id);
    res.json(result);
  }),
);

/**
 * GET /api/identity/digilocker/callback — exchange the authorization code.
 * 501 in basic mode or when credentials are absent. Never stores Aadhaar.
 */
router.get(
  '/digilocker/callback',
  [query('code').optional().isString(), query('state').optional().isString()],
  handleValidation,
  asyncHandler(async (req, res) => {
    const { code, state } = req.query;
    if (!code || !state) throw ApiError.badRequest('Missing code or state');

    const user = await completeDigilocker({ code, state });

    // Redirect back to the app when a client origin is configured.
    if (env.clientOrigin) {
      const url = new URL('/identity/done', env.clientOrigin);
      url.searchParams.set('status', 'success');
      return res.redirect(url.toString());
    }
    return res.json(serializeUser(user));
  }),
);

export default router;
