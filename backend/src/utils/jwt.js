import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

/** Sign a short-lived access token. */
export function signToken(user) {
  return jwt.sign(
    { sub: String(user._id), role: user.role },
    env.jwtSecret,
    { expiresIn: env.jwtExpiresIn },
  );
}

/** Verify a token and return its payload, or throw. */
export function verifyToken(token) {
  return jwt.verify(token, env.jwtSecret);
}
