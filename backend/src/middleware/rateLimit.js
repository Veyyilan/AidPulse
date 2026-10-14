import rateLimit from 'express-rate-limit';

/** Throttle report creation to protect the write path during a surge. */
export const createReportLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many reports submitted, slow down.' },
});

/** Looser limiter for auth endpoints to blunt credential stuffing. */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts, try again later.' },
});
