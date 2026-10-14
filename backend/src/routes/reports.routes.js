import { Router } from 'express';
import { body, query, param } from 'express-validator';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { handleValidation } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/roles.js';
import { createReportLimiter } from '../middleware/rateLimit.js';
import { isValidLatLng, isInsideRegion } from '../utils/geo.js';
import { serializeReport, serializeReports } from '../utils/serialize.js';
import { emitToRooms } from '../realtime/index.js';
import {
  NEED_TYPES,
  REPORT_STATUSES,
  OPERATIONAL_ROOMS,
} from '../config/constants.js';
import {
  createReport,
  getReportById,
  claimReport,
  releaseReport,
  updateReportStatus,
  listReports,
  listMine,
  listNearby,
  detectAndEmitGap,
  findReportByClientId,
} from '../services/reportService.js';

const router = Router();

// Normalise a need type coming from the client ("Medical" -> "medical").
function normalizeNeedType(value) {
  return String(value ?? '').trim().toLowerCase();
}

// Persisted statuses a client may set (frontend sends pending/claimed/resolved).
const SETTABLE_STATUSES = ['pending', 'claimed', 'in_progress', 'resolved', 'cannot_fulfill'];

// ─── POST /api/reports ──────────────────────────────────────────────────────
router.post(
  '/',
  requireAuth,
  requireRole('citizen', 'admin'),
  createReportLimiter,
  [
    body('needType').customSanitizer(normalizeNeedType).isIn(NEED_TYPES),
    body('description').isString().trim().isLength({ min: 10, max: 500 }),
    body('lat').isFloat({ min: -90, max: 90 }).toFloat(),
    body('lng').isFloat({ min: -180, max: 180 }).toFloat(),
    body('accuracyMeters').optional({ nullable: true }).isFloat({ min: 0 }).toFloat(),
    body('accuracy').optional({ nullable: true }).isFloat({ min: 0 }).toFloat(),
    body('clientId').optional({ nullable: true }).isString().trim().isLength({ min: 1, max: 100 }),
  ],
  handleValidation,
  asyncHandler(async (req, res) => {
    const { needType, description, lat, lng } = req.body;
    const accuracyMeters = req.body.accuracyMeters ?? req.body.accuracy ?? null;
    const clientId = req.body.clientId || undefined;

    if (!isValidLatLng(lat, lng)) {
      throw ApiError.unprocessable('Invalid coordinates', [
        { field: 'lat/lng', message: 'Coordinates out of range' },
      ]);
    }
    // Reject coordinates outside Tamil Nadu (or configured deployment region).
    if (!isInsideRegion(lat, lng)) {
      throw ApiError.unprocessable('Location outside Tamil Nadu deployment region (lat 7.9–13.7, lng 76.1–80.5)', [
        { field: 'lat/lng', message: 'Report location must be within Tamil Nadu (lat 7.9–13.7, lng 76.1–80.5)' },
      ]);
    }

    // Idempotency: return this user's existing report if clientId was reused.
    if (clientId) {
      const existing = await findReportByClientId(clientId, req.user._id);
      if (existing) {
        return res.status(200).json(serializeReport(existing));
      }
    }

    let report;
    try {
      report = await createReport({
        userId: req.user._id,
        needType,
        description,
        lat,
        lng,
        accuracyMeters,
        source: 'app',
        clientId,
      });
    } catch (err) {
      if (err.code === 11000 && clientId) {
        const existing = await findReportByClientId(clientId, req.user._id);
        if (existing) {
          return res.status(200).json(serializeReport(existing));
        }
      }
      throw err;
    }

    const payload = serializeReport(report, { distanceKm: 0 });
    emitToRooms(OPERATIONAL_ROOMS, 'report:new', payload);

    // Detect a coverage gap around the new report (may emit gap:alert).
    detectAndEmitGap(lat, lng).catch(() => {});

    res.status(201).json(payload);
  }),
);

// ─── GET /api/reports/mine ──────────────────────────────────────────────────
router.get(
  '/mine',
  requireAuth,
  asyncHandler(async (req, res) => {
    const reports = await listMine(req.user._id);
    res.json(serializeReports(reports));
  }),
);

// ─── GET /api/reports/nearby ────────────────────────────────────────────────
router.get(
  '/nearby',
  requireAuth,
  requireRole('ngo', 'government', 'admin'),
  [
    query('lat').isFloat({ min: -90, max: 90 }).toFloat(),
    query('lng').isFloat({ min: -180, max: 180 }).toFloat(),
    query('maxDistance').optional().isFloat({ min: 1 }).toFloat(),
  ],
  handleValidation,
  asyncHandler(async (req, res) => {
    const { lat, lng, maxDistance } = req.query;
    const results = await listNearby({
      lat,
      lng,
      maxDistanceM: maxDistance || 50000,
    });
    res.json(serializeReports(results));
  }),
);

// ─── GET /api/reports ───────────────────────────────────────────────────────
router.get(
  '/',
  requireAuth,
  requireRole('ngo', 'government', 'admin'),
  [
    query('status').optional().isIn(REPORT_STATUSES),
    query('needType').optional().customSanitizer(normalizeNeedType).isIn(NEED_TYPES),
    query('limit').optional().isInt({ min: 1, max: 500 }).toInt(),
  ],
  handleValidation,
  asyncHandler(async (req, res) => {
    const reports = await listReports({
      status: req.query.status,
      needType: req.query.needType,
      limit: req.query.limit,
    });
    res.json(serializeReports(reports));
  }),
);

// ─── PATCH|POST /api/reports/:id/claim ──────────────────────────────────────
async function handleClaim(req, res) {
  const report = await getReportById(req.params.id);

  // Only pending reports are claimable.
  if (report.status !== 'pending') {
    throw ApiError.conflict('Report is no longer available to claim', {
      status: report.status,
    });
  }

  const updated = await claimReport({ reportId: req.params.id, userId: req.user._id });
  if (!updated) {
    // Lost the race between the read above and the atomic update.
    throw ApiError.conflict('Report was claimed by someone else');
  }

  res.json(serializeReport(updated));
}

router.patch(
  '/:id/claim',
  requireAuth,
  requireRole('ngo'),
  [param('id').isMongoId()],
  handleValidation,
  asyncHandler(handleClaim),
);
router.post(
  '/:id/claim',
  requireAuth,
  requireRole('ngo'),
  [param('id').isMongoId()],
  handleValidation,
  asyncHandler(handleClaim),
);

// ─── PATCH|POST /api/reports/:id/release ────────────────────────────────────
async function handleRelease(req, res) {
  const force = req.user.role === 'admin';
  const updated = await releaseReport({
    reportId: req.params.id,
    userId: req.user._id,
    force,
  });
  if (!updated) {
    throw ApiError.conflict('Report is not currently claimed by you');
  }
  res.json(serializeReport(updated));
}

router.patch(
  '/:id/release',
  requireAuth,
  requireRole('ngo', 'admin'),
  [param('id').isMongoId()],
  handleValidation,
  asyncHandler(handleRelease),
);
router.post(
  '/:id/release',
  requireAuth,
  requireRole('ngo', 'admin'),
  [param('id').isMongoId()],
  handleValidation,
  asyncHandler(handleRelease),
);

// ─── PATCH /api/reports/:id/status ──────────────────────────────────────────
router.patch(
  '/:id/status',
  requireAuth,
  requireRole('ngo', 'government', 'admin'),
  [param('id').isMongoId(), body('status').isIn(SETTABLE_STATUSES)],
  handleValidation,
  asyncHandler(async (req, res) => {
    const updated = await updateReportStatus({
      reportId: req.params.id,
      status: req.body.status,
      userId: req.user._id,
    });
    if (!updated) throw ApiError.notFound('Report not found');
    res.json(serializeReport(updated));
  }),
);

export default router;
