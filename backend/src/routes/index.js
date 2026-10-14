import { Router } from 'express';
import authRoutes from './auth.routes.js';
import identityRoutes from './identity.routes.js';
import reportRoutes from './reports.routes.js';
import govRoutes from './gov.routes.js';

const router = Router();

// Liveness probe (public — used by the test harness and Render health checks).
router.get('/health', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

router.use('/auth', authRoutes);
router.use('/identity', identityRoutes);
router.use('/reports', reportRoutes);
router.use('/gov', govRoutes);

export default router;
