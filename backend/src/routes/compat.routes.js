import { Router } from 'express';
import { param } from 'express-validator';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { handleValidation } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/roles.js';
import { User } from '../models/User.js';
import { Report } from '../models/Report.js';
import { serializeUser } from '../utils/serialize.js';
import { getCoverageGaps, getDuplicateClusters, getOverview } from '../services/statsService.js';

/**
 * Frontend compatibility shim. The existing UI calls these shapes directly;
 * they map onto the same services powering the spec API.
 */
const router = Router();

// GET /api/health
router.get('/health', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// GET /api/users  (admin) — users plus their report counts
router.get(
  '/users',
  requireAuth,
  requireRole('admin'),
  asyncHandler(async (_req, res) => {
    const users = await User.find().select('-passwordHash').sort({ createdAt: -1 });
    const counts = await Report.aggregate([
      { $group: { _id: '$reportedBy', count: { $sum: 1 } } },
    ]);
    const countMap = new Map(counts.map((c) => [String(c._id), c.count]));

    res.json(
      users.map((u) => ({
        ...serializeUser(u),
        reports: countMap.get(String(u._id)) || 0,
      })),
    );
  }),
);

// POST /api/users/:id/suspend  (admin)
router.post(
  '/users/:id/suspend',
  requireAuth,
  requireRole('admin'),
  [param('id').isMongoId()],
  handleValidation,
  asyncHandler(async (req, res) => {
    if (String(req.user._id) === req.params.id) {
      throw ApiError.badRequest('You cannot suspend your own account');
    }
    const user = await User.findByIdAndUpdate(
      req.params.id,
      { $set: { isSuspended: true } },
      { new: true },
    );
    if (!user) throw ApiError.notFound('User not found');
    res.json(serializeUser(user));
  }),
);

// POST /api/users/:id/restore  (admin)
router.post(
  '/users/:id/restore',
  requireAuth,
  requireRole('admin'),
  [param('id').isMongoId()],
  handleValidation,
  asyncHandler(async (req, res) => {
    const user = await User.findByIdAndUpdate(
      req.params.id,
      { $set: { isSuspended: false } },
      { new: true },
    );
    if (!user) throw ApiError.notFound('User not found');
    res.json(serializeUser(user));
  }),
);

// GET /api/stats/overview
router.get(
  '/stats/overview',
  requireAuth,
  requireRole('government', 'admin', 'ngo'),
  asyncHandler(async (_req, res) => {
    res.json(await getOverview());
  }),
);

// GET /api/stats/gaps
router.get(
  '/stats/gaps',
  requireAuth,
  requireRole('government', 'admin', 'ngo'),
  asyncHandler(async (_req, res) => {
    res.json(await getCoverageGaps());
  }),
);

// GET /api/stats/clusters  (duplicate clusters)
router.get(
  '/stats/clusters',
  requireAuth,
  requireRole('government', 'admin', 'ngo'),
  asyncHandler(async (_req, res) => {
    res.json(await getDuplicateClusters());
  }),
);

export default router;
