import { Router } from 'express';
import { body, param } from 'express-validator';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { handleValidation } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/roles.js';
import { User } from '../models/User.js';
import { serializeUser, serializeAudit } from '../utils/serialize.js';
import { getAuditTrail } from '../services/auditService.js';
import { getCoverageGaps, getDuplicateClusters } from '../services/statsService.js';

const router = Router();

// Every admin route requires an authenticated admin.
router.use(requireAuth, requireRole('admin'));

// GET /api/admin/duplicates
router.get(
  '/duplicates',
  asyncHandler(async (_req, res) => {
    res.json(await getDuplicateClusters());
  }),
);

// GET /api/admin/gaps
router.get(
  '/gaps',
  asyncHandler(async (_req, res) => {
    res.json(await getCoverageGaps());
  }),
);

// GET /api/admin/audit/:id  (append-only trail for a report)
router.get(
  '/audit/:id',
  [param('id').isMongoId()],
  handleValidation,
  asyncHandler(async (req, res) => {
    const rows = await getAuditTrail(req.params.id);
    res.json(rows.map(serializeAudit));
  }),
);

// PATCH /api/admin/users/:id/suspend
router.patch(
  '/users/:id/suspend',
  [param('id').isMongoId(), body('suspended').optional().isBoolean().toBoolean()],
  handleValidation,
  asyncHandler(async (req, res) => {
    const suspended = req.body.suspended === undefined ? true : req.body.suspended;

    // Prevent an admin from locking themselves out.
    if (String(req.user._id) === req.params.id && suspended) {
      throw ApiError.badRequest('You cannot suspend your own account');
    }

    const user = await User.findByIdAndUpdate(
      req.params.id,
      { $set: { isSuspended: suspended } },
      { new: true },
    );
    if (!user) throw ApiError.notFound('User not found');
    res.json(serializeUser(user));
  }),
);

export default router;
