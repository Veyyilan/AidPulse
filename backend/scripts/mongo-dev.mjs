/**
 * Local dev helper — boots an in-memory MongoDB on the standard port so the
 * documented dev commands work without installing MongoDB or Docker.
 *
 *   Terminal 1:  npm run mongo:dev
 *   Terminal 2:  npm run seed
 *   Terminal 3:  npm run dev
 *
 * Data is ephemeral: everything disappears when this process stops. Do not use
 * this in production.
 */
import { MongoMemoryServer } from 'mongodb-memory-server';

const PORT = Number(process.env.MEMORY_MONGO_PORT || 27017);
const DB = process.env.MEMORY_MONGO_DB || 'aidpulse';

const mongod = await MongoMemoryServer.create({
  instance: { port: PORT, dbName: DB },
});

console.log(`[mongo:dev] in-memory MongoDB listening at ${mongod.getUri(DB)}`);
console.log('[mongo:dev] data is ephemeral — it disappears when this process stops.');
console.log('[mongo:dev] press Ctrl+C to stop.');

async function shutdown() {
  await mongod.stop();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
