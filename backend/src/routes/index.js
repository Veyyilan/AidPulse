import { Router } from 'express';
import authRoutes from './auth.routes.js';
import reportRoutes from './reports.routes.js';
import adminRoutes from './admin.routes.js';
import smsRoutes from './sms.routes.js';
import compatRoutes from './compat.routes.js';

const router = Router();

router.use('/auth', authRoutes);
router.use('/reports', reportRoutes);
router.use('/admin', adminRoutes);
router.use('/sms', smsRoutes);

// Frontend compatibility shim (/users, /stats/*, /health).
router.use('/', compatRoutes);

export default router;
