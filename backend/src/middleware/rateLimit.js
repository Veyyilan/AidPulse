import rateLimit from 'express-rate-limit';
import { ApiError } from '../utils/ApiError.js';

/**
 * Report creation limiter: 10 genuinely-new reports per 10 minutes per user
 * (fixed window). Keyed by the authenticated user id.
 *
 * Idempotent retries (same user + same clientId) are handled before this
 * middleware runs and are marked with `req.idempotentReport`, so they never
 * consume the budget and always return 200.
 */
export const createReportLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => String(req.user?._id || req.ip),
  skip: (req) => Boolean(req.idempotentReport),
  handler: (_req, _res, next) =>
    next(new ApiError(429, 'Too many reports submitted. Try again in a few minutes.')),
});

/** Looser limiter for auth endpoints to blunt credential stuffing. */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts, try again later.' },
});
