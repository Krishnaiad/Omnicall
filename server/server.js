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

