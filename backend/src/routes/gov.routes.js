import { Router } from 'express';
import { body, param } from 'express-validator';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { handleValidation } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/roles.js';
import { User } from '../models/User.js';
import { Report } from '../models/Report.js';
import { serializeUser, serializeReport } from '../utils/serialize.js';
import { createNgo, setSuspended } from '../services/govService.js';
import { computeGapCells, scanGaps } from '../services/gapService.js';
import { getMergeClusters } from '../services/statsService.js';
import { forceReleaseNeed } from '../services/reportService.js';
import { NEED_TYPES } from '../config/constants.js';

const router = Router();

// Every government route requires authentication + the government role.
router.use(requireAuth, requireRole('government'));

// ─── NGO management ────────────────────────────────────────────────────────
router.post(
  '/ngos',
  [
    body('name').isString().trim().isLength({ min: 2, max: 120 }),
    body('email').isEmail().normalizeEmail(),
    body('phone').optional({ nullable: true }).isString(),
    body('organizationName').optional({ nullable: true }).isString().trim().isLength({ max: 200 }),
    body('capabilities').isArray({ min: 1 }).withMessage('capabilities must be a non-empty array'),
    body('capabilities.*').isIn(NEED_TYPES).withMessage(`capabilities must be a subset of: ${NEED_TYPES.join(', ')}`),
    body('password').optional({ nullable: true }).isString().isLength({ min: 8, max: 200 }),
  ],
  handleValidation,
  asyncHandler(async (req, res) => {
    const { user, tempPassword } = await createNgo({
      name: req.body.name,
      email: req.body.email,
      phone: req.body.phone,
      organizationName: req.body.organizationName,
      capabilities: req.body.capabilities,
      password: req.body.password,
    });

    res.status(201).json({
      ngo: serializeUser(user),
      // Returned once to hand to the organisation. They must change it on first login.
      tempPassword,
    });
  }),
);

router.get(
  '/ngos',
  asyncHandler(async (_req, res) => {
    const ngos = await User.find({ role: 'ngo' }).sort({ createdAt: -1 });
    res.json(ngos.map(serializeUser));
  }),
);

// ─── Gaps / clusters / flags ───────────────────────────────────────────────
router.get(
  '/gaps',
  asyncHandler(async (_req, res) => {
    const cells = await computeGapCells();
    res.json(cells);
  }),
);

// Force a scan right now (also emits gap:alert for changed cells).
router.post(
  '/gaps/scan',
  asyncHandler(async (_req, res) => {
    const changed = await scanGaps();
    res.json({ changed });
  }),
);

router.get(
  '/clusters',
  asyncHandler(async (_req, res) => {
    const clusters = await getMergeClusters();
    res.json(clusters);
  }),
);

router.get(
  '/flags',
  asyncHandler(async (_req, res) => {
    const flagged = await Report.find({ 'flags.0': { $exists: true } }).sort({ createdAt: -1 }).limit(200);
    res.json(flagged.map((r) => serializeReport(r)));
  }),
);

// ─── User suspension ───────────────────────────────────────────────────────
router.post(
  '/users/:id/suspend',
  [param('id').isMongoId()],
  handleValidation,
  asyncHandler(async (req, res) => {
    if (String(req.params.id) === String(req.user._id)) {
      throw ApiError.unprocessable('You cannot suspend your own account');
    }
    const user = await setSuspended(req.params.id, true);
    res.json(serializeUser(user));
  }),
);

router.post(
  '/users/:id/restore',
  [param('id').isMongoId()],
  handleValidation,
  asyncHandler(async (req, res) => {
    const user = await setSuspended(req.params.id, false);
    res.json(serializeUser(user));
  }),
);

// ─── Force release ─────────────────────────────────────────────────────────
router.post(
  '/force-release',
  [
    body('reportId').isMongoId(),
    body('needType').optional({ nullable: true }).isIn(NEED_TYPES),
  ],
  handleValidation,
  asyncHandler(async (req, res) => {
    const { report, released } = await forceReleaseNeed({
      reportId: req.body.reportId,
      needType: req.body.needType || null,
      actorId: req.user._id,
    });
    res.json({ released, report: serializeReport(report) });
  }),
);

export default router;
