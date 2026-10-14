import { ApiError } from '../utils/ApiError.js';
import { verifyToken } from '../utils/jwt.js';
import { User } from '../models/User.js';

/**
 * Routes a user with `mustChangePassword` may still reach. Everything else is
 * refused with 403 until they change it. The flag is re-read from the database
 * on every request below — it is never cached from the token.
 */
function passwordChangeAllowed(req) {
  const url = String(req.originalUrl || req.url || '').split('?')[0].replace(/\/+$/, '');
  return (
    (req.method === 'GET' && url.endsWith('/auth/me')) ||
    (req.method === 'POST' && url.endsWith('/auth/change-password'))
  );
}

/**
 * Verify the Bearer token, load the user from the database, and reject
 * suspended accounts with 401. Attaches `req.user` on success.
 *
 * The role is always read from the database, never trusted from the token, so
 * a stale/forged role claim in the JWT cannot grant access. A user who still
 * needs to change their (temporary) password may only reach `GET /auth/me` and
 * `POST /auth/change-password`; every other route returns 403.
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
    if (user.isSuspended) throw ApiError.unauthorized('Account suspended');

    if (user.mustChangePassword && !passwordChangeAllowed(req)) {
      throw ApiError.forbidden('You must change your password before using the API');
    }

    req.user = user;
    req.token = token;
    next();
  } catch (err) {
    next(err);
  }
}
