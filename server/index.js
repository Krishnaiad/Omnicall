import 'dotenv/config';
import express from 'express';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import jwt from 'jsonwebtoken';

import authRouter from './auth.js';
import roomRouter from './room.js';
import mediaRouter from './media.js';
import { db } from './db.js';

const app = express();
const server = http.createServer(app);

const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5173';

// Security Headers & CORS
app.use(
  helmet({
    contentSecurityPolicy: false, // allow inline media streams during dev
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
);

app.use(
  cors({
    origin: CLIENT_ORIGIN,
    credentials: true,
  })
);

app.use(express.json({ limit: '10kb' }));

// Global Rate Limiter
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  message: { error: 'Too many requests from this IP, please try again later.' },
});
app.use('/api/', apiLimiter);

// API Routers
app.use('/api/auth', authRouter);
app.use('/api/rooms', roomRouter);
app.use('/api/media', mediaRouter);

app.get('/healthz', (_req, res) => res.json({ ok: true, timestamp: new Date().toISOString() }));

// Socket.io Real-time Chat & Permission Stage setup
const io = new SocketIOServer(server, {
  cors: {
    origin: CLIENT_ORIGIN,
    methods: ['GET', 'POST'],
  },
});

// Middleware: Authenticate Socket connection via JWT
io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) {
    return next(new Error('Authentication token required'));
  }
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET || 'super_secret_jwt_key_change_in_production_12345');
    socket.user = { id: payload.sub, email: payload.email, name: payload.name };
    next();
  } catch (err) {
    next(new Error('Invalid token'));
  }
});

// Simple server-side string escaping to prevent XSS in chat
function sanitizeText(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

io.on('connection', (socket) => {
  socket.on('join-room', ({ roomId }) => {
    const isMember = db.prepare('SELECT 1 FROM room_members WHERE room_id = ? AND user_id = ?').get(roomId, socket.user.id);
    if (!isMember) {
      return socket.emit('error-msg', { message: 'Not authorized to join chat in this room' });
    }
    socket.join(roomId);
  });

  socket.on('send-message', ({ roomId, text }) => {
    if (!text || !text.trim()) return;

    const sanitized = sanitizeText(text.trim());
    const messageObj = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      senderId: socket.user.id,
      senderName: socket.user.name,
      text: sanitized,
      timestamp: new Date().toISOString(),
    };

    io.to(roomId).emit('new-message', messageObj);
  });

  // Room Owner Snapshot Broadcast Notification
  socket.on('snapshot-taken', ({ roomId, displayName }) => {
    const room = db.prepare('SELECT owner_id FROM rooms WHERE id = ?').get(roomId);
    if (!room || room.owner_id !== socket.user.id) {
      return socket.emit('error-msg', { message: 'Only the room owner can capture snapshots' });
    }
    const name = displayName || socket.user.name;
    io.to(roomId).emit('snapshot-notification', {
      takenBy: name,
      timestamp: new Date().toISOString(),
    });
  });

  // Shared Presentation Screen Broadcast
  socket.on('share-presentation-media', ({ roomId, mediaUrl, mediaName, mediaType, presenterName }) => {
    io.to(roomId).emit('presentation-media-changed', {
      mediaUrl,
      mediaName,
      mediaType,
      presenterName: presenterName || socket.user.name,
    });
  });

  socket.on('stop-presentation-media', ({ roomId }) => {
    io.to(roomId).emit('presentation-media-changed', null);
  });

  // Screen Share Permission Request (Participant -> Owner)
  socket.on('request-screen-share-permission', ({ roomId, requesterName }) => {
    const room = db.prepare('SELECT owner_id FROM rooms WHERE id = ?').get(roomId);
    if (!room) return;

    // Send request popup event to room
    io.to(roomId).emit('screen-share-request-received', {
      requesterSocketId: socket.id,
      requesterUserId: socket.user.id,
      requesterName: requesterName || socket.user.name,
      ownerUserId: room.owner_id,
    });
  });

  // Screen Share Permission Response (Owner -> Participant)
  socket.on('respond-screen-share-permission', ({ requesterSocketId, allowed }) => {
    io.to(requesterSocketId).emit('screen-share-permission-result', { allowed });
  });
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
