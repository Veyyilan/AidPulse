import http from 'node:http';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import mongoSanitize from 'express-mongo-sanitize';

import { env } from './config/env.js';
import { connectDb, disconnectDb } from './config/db.js';
import { syncReportIndexes } from './config/indexes.js';
import { initRealtime } from './realtime/index.js';
import { ensureGovernmentUser } from './services/govService.js';
import { startScheduler } from './jobs/index.js';
import routes from './routes/index.js';
import { notFoundHandler, errorHandler } from './middleware/errorHandler.js';

const app = express();
app.disable('x-powered-by');
// Correct client IPs behind a proxy (Render) for rate limiting.
app.set('trust proxy', 1);

// ─── Security & parsing ─────────────────────────────────────────────────────
app.use(helmet());
app.use(
  cors({
    origin: env.clientOrigin,
    credentials: true,
  }),
);
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: false, limit: '100kb' }));
// Strip `$` and `.` operators from user input to block NoSQL injection.
app.use(mongoSanitize());

if (!env.isProd) app.use(morgan('dev'));

// ─── Routes ─────────────────────────────────────────────────────────────────
app.use('/api', routes);

app.use(notFoundHandler);
app.use(errorHandler);

// ─── Bootstrap ──────────────────────────────────────────────────────────────
const server = http.createServer(app);
initRealtime(server);

async function start() {
  try {
    await connectDb();
    await syncReportIndexes();
    await ensureGovernmentUser();
    startScheduler();

    server.listen(env.port, () => {
      // eslint-disable-next-line no-console
      console.log(`[server] AidPulse API listening on http://localhost:${env.port}`);
      // eslint-disable-next-line no-console
      console.log(`[server] CORS origin: ${env.clientOrigin}`);
      // eslint-disable-next-line no-console
      console.log(`[server] identity mode: ${env.identityMode}`);
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[server] failed to start:', err.message);
    process.exit(1);
  }
}

// ─── Graceful shutdown ──────────────────────────────────────────────────────
async function shutdown(signal) {
  // eslint-disable-next-line no-console
  console.log(`[server] ${signal} received, shutting down…`);
  server.close(async () => {
    await disconnectDb().catch(() => {});
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

start();
