import { Router } from 'express';
import jwt from 'jsonwebtoken';

const router = Router();

// ─── SSE Connection Store ───────────────────────────────────────────────────
// In-process Map: userId → Set of active SSE response objects
//
// ⚠️  SINGLE-INSTANCE ONLY: This works correctly for one Node.js process.
// When you add a second server instance (Docker replica, Render scale-up),
// users connected to different instances won't receive cross-instance events.
// Upgrade path (when needed): replace notifyUser() with Redis Pub/Sub:
//   publisher.publish(`user:${userId}`, JSON.stringify(data))
//   each instance subscribes and forwards to its local SSE clients
// ────────────────────────────────────────────────────────────────────────────
const clients = new Map(); // userId → Set<res>
const MAX_CONNECTIONS_PER_USER = 5; // Prevents connection leak from unclosed tabs

function getSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is not configured');
  return secret;
}

// GET /api/notifications/stream?token=xxx  (or Authorization: Bearer xxx)
router.get('/stream', (req, res) => {
  const token =
    req.query.token ||
    (req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : null);

  if (!token) {
    return res.status(401).json({ error: 'Authentication token required for notifications stream' });
  }

  let userId;
  try {
    const payload = jwt.verify(token, getSecret());
    userId = payload.sub;
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  // Enforce max connections per user to prevent stale-tab accumulation
  if (!clients.has(userId)) {
    clients.set(userId, new Set());
  }
  const userConnections = clients.get(userId);

  if (userConnections.size >= MAX_CONNECTIONS_PER_USER) {
    // Evict the oldest connection to make room for the new one
    const oldest = userConnections.values().next().value;
    try {
      oldest.end();
    } catch {}
    userConnections.delete(oldest);
    console.warn(`[SSE] Evicted oldest connection for user ${userId} (limit: ${MAX_CONNECTIONS_PER_USER})`);
  }

  // Set SSE response headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',     // Disable nginx buffering
    'Access-Control-Allow-Origin': '*',
  });

  // Send initial CONNECTED event so client knows the stream is live
  res.write(`data: ${JSON.stringify({ type: 'CONNECTED', userId, timestamp: new Date().toISOString() })}\n\n`);

  userConnections.add(res);

  // Keep-alive heartbeat every 25 seconds (proxies/load balancers close idle connections at 30s)
  const heartbeat = setInterval(() => {
    try {
      res.write(': heartbeat\n\n');
    } catch {
      // Connection already closed — clean up
      clearInterval(heartbeat);
      cleanup();
    }
  }, 25000);

  function cleanup() {
    clearInterval(heartbeat);
    const userClients = clients.get(userId);
    if (userClients) {
      userClients.delete(res);
      if (userClients.size === 0) {
        clients.delete(userId);
      }
    }
  }

  // Clean up on client disconnect (tab close, network drop, navigate away)
  req.on('close', cleanup);
  req.on('error', cleanup);
  res.on('error', cleanup);
});

/**
 * Send a real-time event to all SSE connections for a user.
 * Fire-and-forget: broken connections are removed from the map silently.
 */
export function notifyUser(userId, data) {
  const userClients = clients.get(userId);
  if (!userClients || userClients.size === 0) return;

  const payload = `data: ${JSON.stringify(data)}\n\n`;
  const broken = [];

  userClients.forEach((res) => {
    try {
      res.write(payload);
    } catch (err) {
      console.warn(`[SSE] Broken connection for user ${userId} — removing:`, err.message);
      broken.push(res);
    }
  });

  // Purge broken connections discovered during send
  for (const res of broken) {
    userClients.delete(res);
  }
  if (userClients.size === 0) {
    clients.delete(userId);
  }
}

/**
 * Returns the number of active SSE connections (for /health or monitoring)
 */
export function getConnectionCount() {
  let total = 0;
  clients.forEach((set) => { total += set.size; });
  return total;
}

export default router;
