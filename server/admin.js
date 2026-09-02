import { Router } from 'express';
import { requireAuth, requireAdmin } from './auth.js';
import { db } from './db.js';
import { metricsStore } from './logger.js';

const router = Router();

// GET /api/admin/health-metrics
router.get('/health-metrics', requireAuth, requireAdmin, async (req, res) => {
  try {
    let poolStats = null;
    
    // Attempt to fetch pg.Pool stats if db has a pool
    if (db.pool) {
      poolStats = {
        totalCount: db.pool.totalCount,
        idleCount: db.pool.idleCount,
        waitingCount: db.pool.waitingCount,
      };
    }
    
    res.json({
      uptime: process.uptime(),
      metrics: metricsStore,
      dbPool: poolStats,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch metrics' });
  }
});

export default router;
