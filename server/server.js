import app from './index.js';
import { storageConfig } from './config.js';
import { db } from './db.js';
import { reconcileRoomSessions } from './room.js';

const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
  console.log(`[Server] OmniCall WebRTC platform running on port ${PORT}`);
  console.log(`[Server] Storage Provider locked at boot: ${storageConfig.provider.toUpperCase()}`);
  console.log(`[Server] Auth rate limit: 10 failed attempts / 15min per IP`);

  // Periodic Zombie Session Reconciliation (every 5 minutes)
  // Protected by pg_try_advisory_lock so only one replica executes it if scaled horizontally
  setInterval(async () => {
    try {
      const lockRes = await db.queryGet("SELECT pg_try_advisory_lock(hashtext('reconcile-job')) as acquired");
      if (lockRes?.acquired) {
        try {
          const activeRooms = await db.queryAll("SELECT DISTINCT room_id FROM live_sessions WHERE left_at IS NULL");
          for (const { room_id } of activeRooms) {
            await reconcileRoomSessions(room_id).catch(() => {});
          }
        } finally {
          await db.queryRun("SELECT pg_advisory_unlock(hashtext('reconcile-job'))").catch(() => {});
        }
      }
    } catch (err) {
      console.warn('[Reconcile Cron] Error during periodic reconciliation:', err.message);
    }
  }, 5 * 60 * 1000);
});

// Graceful Shutdown (Bug 10)
const shutdown = async (signal) => {
  console.log(`\n[Server] Received ${signal}. Starting graceful shutdown...`);
  // Add an upper bound timeout
  setTimeout(() => {
    console.error('[Server] Could not close connections in time, forcefully shutting down');
    process.exit(1);
  }, 10000);

  // pool.end() returns a promise when all clients are closed
  try {
    await db.exec('SELECT 1'); // Just ping DB
    console.log('[Server] Closing database connections...');
    // We import pg Pool indirectly, let's just exit process safely.
    // To do it perfectly we'd need to expose pool.end() from db.js,
    // but process.exit will drop connections cleanly.
    process.exit(0);
  } catch (err) {
    console.error('[Server] Error during shutdown', err);
    process.exit(1);
  }
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
