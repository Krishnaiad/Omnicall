import 'dotenv/config';
import { storageConfig } from './config.js';
import express from 'express';
import { createServer } from 'http';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { db } from './db.js';
import { healthCheck as r2HealthCheck } from './r2.js';
import { healthCheck as cloudinaryHealthCheck } from './cloudinary.js';
import authRouter from './auth.js';
import roomRouter from './room.js';
import mediaRouter from './media.js';
import notificationRouter from './notifications.js';
import memoriesRouter from './memories.js';
import { handleLiveKitWebhook } from './webhooks.js';


const app = express();
const server = createServer(app);

const PORT = process.env.PORT || 4000;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || '*';

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
);

const CORS_ALLOWED_ORIGINS = new Set([
  'https://omnicall-lac.vercel.app',
  'http://localhost:5173',
  'http://localhost:3000',
  ...(process.env.EXTRA_ALLOWED_ORIGINS ? process.env.EXTRA_ALLOWED_ORIGINS.split(',').map(o => o.trim()) : []),
]);

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (mobile apps, curl, Postman, server-to-server)
      if (!origin) return callback(null, true);
      if (CORS_ALLOWED_ORIGINS.has(origin)) return callback(null, true);
      return callback(new Error(`CORS: Origin "${origin}" is not allowed.`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  })
);

// ── LiveKit Webhook: MUST be mounted BEFORE express.json() to receive raw body for HMAC verification ──
app.post('/api/webhooks/livekit', express.raw({ type: 'application/webhook+json' }), handleLiveKitWebhook);

app.use(express.json());

// Auth rate limiter: strict limit on login/register to prevent brute-force attacks
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  skipSuccessfulRequests: true,
  message: { error: 'Too many authentication attempts. Please wait 15 minutes before trying again.' },
  standardHeaders: true,
  legacyHeaders: false,
});


const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  message: { error: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);
app.use('/api/', apiLimiter);


// API Routers
app.use('/api/auth', authRouter);
app.use('/api/rooms', roomRouter);
app.use('/api/media', mediaRouter);
app.use('/api/notifications', notificationRouter);
app.use('/api/memories', memoriesRouter);


// Production Health Check (DB + Storage)
app.get('/health', async (_req, res) => {
  let dbOk = false;
  try {
    const row = await db.queryGet('SELECT 1 as ok');
    dbOk = !!row;
  } catch {
    dbOk = false;
  }

  let storageStatus = { ok: true, provider: 'local' };
  if (storageConfig.provider === 'cloudinary') {
    storageStatus = await cloudinaryHealthCheck();
  } else if (storageConfig.provider === 'r2') {
    storageStatus = await r2HealthCheck();
  }

  const isHealthy = dbOk && storageStatus.ok;

  res.status(isHealthy ? 200 : 503).json({
    status: isHealthy ? 'healthy' : 'degraded',
    db: { ok: dbOk, provider: db.isPg() ? 'postgres' : 'sqlite' },
    storage: storageStatus,
    timestamp: new Date().toISOString(),
  });
});

server.listen(PORT, () => {
  console.log(`[Server] OmniCall WebRTC platform running on port ${PORT}`);
  console.log(`[Server] Storage Provider locked at boot: ${storageConfig.provider.toUpperCase()}`);
  console.log(`[Server] Auth rate limit: 10 failed attempts / 15min per IP`);
});
