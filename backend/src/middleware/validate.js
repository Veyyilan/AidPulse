import { validationResult } from 'express-validator';
import { ApiError } from '../utils/ApiError.js';

/**
 * Terminate a validated chain: collect express-validator errors and raise 422.
 */
export function handleValidation(req, _res, next) {
  const result = validationResult(req);
  if (!result.isEmpty()) {
    const details = result.array().map((e) => ({
      field: e.path,
      message: e.msg,
    }));
    return next(ApiError.unprocessable('Validation failed', details));
  }
  return next();
}

export { body, param, query } from 'express-validator';
