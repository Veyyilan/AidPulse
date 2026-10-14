import { Router } from 'express';
import { body } from 'express-validator';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { env } from '../config/env.js';
import { handleValidation } from '../middleware/validate.js';
import { serializeReport } from '../utils/serialize.js';
import { emitToRooms } from '../realtime/index.js';
import { createReport, resolveSmsUserId, detectAndEmitGap } from '../services/reportService.js';
import { NEED_TYPES, OPERATIONAL_ROOMS } from '../config/constants.js';
import { isInsideRegion, isValidLatLng } from '../utils/geo.js';

const router = Router();

// Default centre used when an SMS carries a place name we cannot geocode.
const FALLBACK_CENTER = { lat: 6.4550, lng: 3.3841 };

/** Reject the webhook unless the shared secret matches. */
function requireApiKey(req, _res, next) {
  const key = req.headers['x-api-key'];
  if (!env.smsApiKey || key !== env.smsApiKey) {
    return next(ApiError.unauthorized('Invalid SMS API key'));
  }
  return next();
}

/**
 * Parse a free-text SMS of the form:
 *   "MEDICAL, 12 Broad Street, 6.4550, 3.3841"
 *   "WATER, borehole broken near the market"
 * Returns { needType, description, lat?, lng? }.
 */
export function parseSmsBody(text) {
  const raw = String(text || '').trim();
  const parts = raw.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return null;

  const head = parts[0].toLowerCase();
  const needType = NEED_TYPES.includes(head) ? head : null;

  let lat;
  let lng;
  const tail = parts.slice(1);

  // Look for a coordinate pair anywhere in the tail (or a leading pair).
  const numeric = tail.filter((p) => /^-?\d+(\.\d+)?$/.test(p)).map(Number);
  if (numeric.length >= 2) {
    lat = numeric[numeric.length - 2];
    lng = numeric[numeric.length - 1];
  } else {
    const allNumeric = parts.filter((p) => /^-?\d+(\.\d+)?$/.test(p)).map(Number);
    if (allNumeric.length >= 2) {
      lat = allNumeric[0];
      lng = allNumeric[1];
    }
  }

  const description = (needType ? tail.join(', ') : parts.join(', ')).slice(0, 500) || raw.slice(0, 500);

  return { needType, description, lat, lng };
}

// POST /api/sms/inbound
router.post(
  '/inbound',
  requireApiKey,
  [body('text').isString().isLength({ min: 3, max: 640 })],
  handleValidation,
  asyncHandler(async (req, res) => {
    const parsed = parseSmsBody(req.body.text);
    if (!parsed || !parsed.needType) {
      throw ApiError.unprocessable('Could not parse an SMS need type', [
        { field: 'text', message: `First token must be one of: ${NEED_TYPES.join(', ')}` },
      ]);
    }

    // Fall back to the deployment centre when no coordinates were supplied.
    let { lat, lng } = parsed;
    if (!isValidLatLng(lat, lng) || !isInsideRegion(lat, lng)) {
      lat = FALLBACK_CENTER.lat;
      lng = FALLBACK_CENTER.lng;
    }

    const smsUserId = await resolveSmsUserId();
    const report = await createReport({
      userId: smsUserId,
      needType: parsed.needType,
      description: parsed.description,
      lat,
      lng,
      accuracyMeters: null,
      source: 'sms',
    });

    const payload = serializeReport(report);
    emitToRooms(OPERATIONAL_ROOMS, 'report:new', payload);
    detectAndEmitGap(lat, lng).catch(() => {});

    res.status(201).json({
      ...payload,
      parsedFrom: req.body.text,
      geocoded: Boolean(parsed.lat !== undefined && parsed.lng !== undefined),
    });
  }),
);

export default router;
