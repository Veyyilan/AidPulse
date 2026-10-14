import { ApiError } from '../utils/ApiError.js';
import { verifyToken } from '../utils/jwt.js';
import { User } from '../models/User.js';

/**
 * Verify the Bearer token, load the user, and reject suspended accounts.
 * Attaches `req.user` (a lean user document) on success.
 */
export async function requireAuth(req, _res, next) {
  try {
    const header = req.headers.authorization || '';
    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token) {
      throw ApiError.unauthorized('Missing bearer token');
    }

    let payload;
    try {
      payload = verifyToken(token);
    } catch {
      throw ApiError.unauthorized('Invalid or expired token');
    }

    const user = await User.findById(payload.sub).select('-passwordHash');
    if (!user) throw ApiError.unauthorized('User no longer exists');
    if (user.isSuspended) throw ApiError.forbidden('Account suspended');

    req.user = user;
    req.token = token;
    next();
  } catch (err) {
    next(err);
  }
}
