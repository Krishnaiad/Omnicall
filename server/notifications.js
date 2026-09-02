import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { redisPublisher, redisSubscriber } from './redis.js';

const router = Router();

const clients = new Map(); // userId → Set<res>
const MAX_CONNECTIONS_PER_USER = 5;

// Listen for cross-instance notifications
redisSubscriber.subscribe('sse_notifications', (err) => {
  if (err) console.error('[Redis] Failed to subscribe to sse_notifications', err);
});

redisSubscriber.on('message', (channel, message) => {
  if (channel === 'sse_notifications') {
    try {
      const { userId, data } = JSON.parse(message);
      const userClients = clients.get(userId);
      if (userClients) {
        const payload = `data: ${JSON.stringify(data)}\n\n`;
        const broken = [];
        userClients.forEach((res) => {
          try {
            res.write(payload);
          } catch (e) {
            broken.push(res);
          }
        });
        for (const res of broken) userClients.delete(res);
        if (userClients.size === 0) clients.delete(userId);
      }
    } catch (e) {
      console.error('[Redis] Failed to process incoming SSE message', e);
    }
  }
});
// Prevents connection leak from unclosed tabs

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
 * Send a real-time event to all SSE connections for a user via Redis Pub/Sub.
 */
export function notifyUser(userId, data) {
  redisPublisher.publish('sse_notifications', JSON.stringify({ userId, data }));
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
