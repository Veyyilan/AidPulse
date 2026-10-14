import { env } from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';

/** 404 fallback for unmatched routes. */
export function notFoundHandler(req, _res, next) {
  next(ApiError.notFound(`Route not found: ${req.method} ${req.originalUrl}`));
}

/** Central error handler. Keep it last in the middleware chain. */
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, _req, res, _next) {
  let status = err.statusCode || err.status || 500;
  let message = err.message || 'Internal server error';
  let details = err.details;

  // Mongoose validation
  if (err.name === 'ValidationError') {
    status = 422;
    message = 'Validation failed';
    details = Object.values(err.errors || {}).map((e) => ({
      field: e.path,
      message: e.message,
    }));
  }

  // Duplicate key
  if (err.code === 11000) {
    status = 409;
    message = 'Duplicate key';
    details = err.keyValue;
  }

  // Invalid ObjectId
  if (err.name === 'CastError') {
    status = 400;
    message = `Invalid ${err.path}`;
  }

  if (status >= 500) {
    // eslint-disable-next-line no-console
    console.error('[error]', err);
  }

  const body = { error: message };
  if (details) body.details = details;
  if (!env.isProd && status >= 500) body.stack = err.stack;

  res.status(status).json(body);
}
