import { ApiError } from '../utils/ApiError.js';

/**
 * Role guard. Must run after `requireAuth`.
 * Usage: requireRole('ngo', 'admin')
 */
export function requireRole(...allowed) {
  return function roleGuard(req, _res, next) {
    if (!req.user) return next(ApiError.unauthorized());
    if (!allowed.includes(req.user.role)) {
      return next(ApiError.forbidden(`Requires role: ${allowed.join(' or ')}`));
    }
    return next();
  };
}
