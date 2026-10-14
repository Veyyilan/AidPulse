import { Router } from 'express';
import { body, param, query } from 'express-validator';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { handleValidation } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/roles.js';
import { createReportLimiter } from '../middleware/rateLimit.js';
import { serializeReport } from '../utils/serialize.js';
import { isInsideRegion, isValidLatLng } from '../utils/geo.js';
import { NEED_TYPES, NEED_STATUSES, REGION_BOUNDS } from '../config/constants.js';
import {
  createReport,
  findReportByClientId,
  listFeed,
  listMine,
  claimNeed,
  updateNeedStatus,
  releaseNeed,
} from '../services/reportService.js';

const router = Router();

router.use(requireAuth);

/**
 * Idempotency runs BEFORE the rate limiter. A retry with the same
 * (user, clientId) returns the originally created report with 200 and never
 * consumes rate-limit budget.
 */
async function idempotencyCheck(req, res, next) {
  try {
    const clientId = req.body?.clientId;
    if (!clientId) return next();

    const existing = await findReportByClientId(clientId, req.user._id);
    if (existing) {
      req.idempotentReport = existing;
      return res.status(200).json(serializeReport(existing));
    }
    return next();
  } catch (err) {
    return next(err);
  }
}

// ─── Create ────────────────────────────────────────────────────────────────
router.post(
  '/',
  idempotencyCheck,
  createReportLimiter,
  [
    body('needs').isArray({ min: 1 }).withMessage('needs must be a non-empty array'),
    body('needs.*').isIn(NEED_TYPES).withMessage(`each need must be one of: ${NEED_TYPES.join(', ')}`),
    body('lat')
      .isFloat({ min: REGION_BOUNDS.minLat, max: REGION_BOUNDS.maxLat })
      .withMessage(`lat must be within ${REGION_BOUNDS.minLat}–${REGION_BOUNDS.maxLat} (Tamil Nadu)`),
    body('lng')
      .isFloat({ min: REGION_BOUNDS.minLng, max: REGION_BOUNDS.maxLng })
      .withMessage(`lng must be within ${REGION_BOUNDS.minLng}–${REGION_BOUNDS.maxLng} (Tamil Nadu)`),
    body('accuracyMeters').optional({ nullable: true }).isFloat({ min: 0 }),
    body('clientId').optional({ nullable: true }).isString().isLength({ min: 1, max: 100 }),
  ],
  handleValidation,
  asyncHandler(async (req, res) => {
    const { needs, lat, lng, accuracyMeters, clientId } = req.body;

    // Defence in depth: validate again in case the route is reused.
    if (!isValidLatLng(Number(lat), Number(lng)) || !isInsideRegion(Number(lat), Number(lng))) {
      throw ApiError.unprocessable('Location is outside the supported region (Tamil Nadu)');
    }

    const { report } = await createReport({
      userId: req.user._id,
      needs,
      lat: Number(lat),
      lng: Number(lng),
      accuracyMeters: accuracyMeters === undefined || accuracyMeters === null ? null : Number(accuracyMeters),
      clientId,
    });

    res.status(201).json(serializeReport(report));
  }),
);

// ─── Reads ─────────────────────────────────────────────────────────────────
router.get(
  '/',
  [
    query('status').optional().isIn(NEED_STATUSES),
    query('needType').optional().isIn(NEED_TYPES),
    query('limit').optional().isInt({ min: 1, max: 500 }),
  ],
  handleValidation,
  asyncHandler(async (req, res) => {
    const reports = await listFeed({
      role: req.user.role,
      capabilities: req.user.capabilities || [],
      status: req.query.status,
      needType: req.query.needType,
      limit: req.query.limit,
    });
    // Citizens never see who reported what.
    const hideReporter = req.user.role === 'citizen';
    res.json(reports.map((r) => serializeReport(r, { hideReporter })));
  }),
);

router.get(
  '/mine',
  asyncHandler(async (req, res) => {
    const reports = await listMine(req.user._id);
    // A merged contributor sees the resolved primary; never expose another
    // reporter's identity (id/phone/name) to a citizen.
    const hideReporter = req.user.role === 'citizen';
    res.json(reports.map((r) => serializeReport(r, { hideReporter })));
  }),
);

// ─── Per-need actions (NGO only) ───────────────────────────────────────────
const needParam = [param('id').isMongoId(), param('type').isIn(NEED_TYPES)];

router.post(
  '/:id/needs/:type/claim',
  requireRole('ngo'),
  needParam,
  handleValidation,
  asyncHandler(async (req, res) => {
    const report = await claimNeed({
      reportId: req.params.id,
      needType: req.params.type,
      actor: req.user,
    });
    res.json(serializeReport(report));
  }),
);

async function setStatusHandler(req, res) {
  const report = await updateNeedStatus({
    reportId: req.params.id,
    needType: req.params.type,
    status: req.body.status,
    actor: req.user,
  });
  res.json(serializeReport(report));
}

router.patch(
  '/:id/needs/:type/status',
  requireRole('ngo'),
  [...needParam, body('status').isIn(NEED_STATUSES)],
  handleValidation,
  asyncHandler(setStatusHandler),
);

// Alias so clients that only speak POST for actions still work.
router.post(
  '/:id/needs/:type/status',
  requireRole('ngo'),
  [...needParam, body('status').isIn(NEED_STATUSES)],
  handleValidation,
  asyncHandler(setStatusHandler),
);

router.post(
  '/:id/needs/:type/release',
  requireRole('ngo'),
  needParam,
  handleValidation,
  asyncHandler(async (req, res) => {
    const report = await releaseNeed({
      reportId: req.params.id,
      needType: req.params.type,
      actor: req.user,
    });
    res.json(serializeReport(report));
  }),
);

export default router;
