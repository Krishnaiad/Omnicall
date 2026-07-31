import express from 'express';
import { createServer } from 'http';
import { Server as ServerIO } from 'socket.io';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import { db } from './db.js';
import authRouter from './auth.js';
import roomRouter from './room.js';
import mediaRouter from './media.js';

const app = express();
const server = createServer(app);

const PORT = process.env.PORT || 4000;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || '*';

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
);

app.use(
  cors({
    origin: CLIENT_ORIGIN,
    credentials: true,
  })
);

app.use(express.json());

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
const io = new ServerIO(server, {
  cors: {
    origin: CLIENT_ORIGIN,
    methods: ['GET', 'POST'],
  },
});

app.set('io', io);

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
  socket.join(`user_${socket.user.id}`);

  socket.on('join-room', async ({ roomId }) => {
    const isMember = await db.queryGet('SELECT 1 FROM room_members WHERE room_id = ? AND user_id = ?', [roomId, socket.user.id]);
    if (!isMember) {
      return socket.emit('error-msg', { message: 'Not authorized to join chat in this room' });
    }
    socket.join(roomId);
  });

  socket.on('send-message', async ({ roomId, text }) => {
    if (!text || !text.trim()) return;

    const sanitized = sanitizeText(text.trim());
    const messageObj = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      senderId: socket.user.id,
      senderName: socket.user.name,
      text: sanitized,
      timestamp: new Date().toISOString(),
    };

    try {
      await db.queryRun(
        'INSERT INTO chat_messages (id, room_id, sender_id, sender_name, message) VALUES (?, ?, ?, ?, ?)',
        [messageObj.id, roomId, messageObj.senderId, messageObj.senderName, messageObj.text]
      );
    } catch (err) {
      console.error('Save chat message failed:', err);
    }

    io.to(roomId).emit('new-message', messageObj);
  });

  // Owner End Meeting for All Broadcast
  socket.on('end-meeting-for-all', async ({ roomId }) => {
    const room = await db.queryGet('SELECT owner_id FROM rooms WHERE id = ?', [roomId]);
    if (!room || room.owner_id !== socket.user.id) {
      return socket.emit('error-msg', { message: 'Only the room creator can end the meeting for all' });
    }
    io.to(roomId).emit('meeting-ended', { endedBy: socket.user.name });
  });

  // Real-time Display Name Update Broadcast
  socket.on('user-renamed', ({ roomId, newDisplayName }) => {
    io.to(roomId).emit('participant-renamed', {
      userId: socket.user.id,
      newDisplayName,
    });
  });

  // Room Owner Snapshot Broadcast Notification
  socket.on('snapshot-taken', async ({ roomId, displayName }) => {
    const room = await db.queryGet('SELECT owner_id FROM rooms WHERE id = ?', [roomId]);
    if (!room || room.owner_id !== socket.user.id) {
      return socket.emit('error-msg', { message: 'Only the room owner can capture snapshots' });
    }
    const name = displayName || socket.user.name;
    io.to(roomId).emit('snapshot-notification', {
      takenBy: name,
      timestamp: new Date().toISOString(),
    });
  });

  // Screen Share Permission Socket Handler
  socket.on('request-screen-share-permission', async ({ roomId, requesterName }) => {
    const room = await db.queryGet('SELECT owner_id FROM rooms WHERE id = ?', [roomId]);
    if (!room) return;

    io.to(`user_${room.owner_id}`).emit('screen-share-request-received', {
      requesterUserId: socket.user.id,
      requesterName,
      requesterSocketId: socket.id,
      roomId,
    });
  });

  socket.on('respond-screen-share-permission', ({ requesterSocketId, allowed }) => {
    io.to(requesterSocketId).emit('screen-share-permission-result', { allowed });
  });

  // Presentation Stage Media Broadcast Handler
  socket.on('share-presentation-media', ({ roomId, mediaUrl, mediaName, mediaType, presenterName }) => {
    io.to(roomId).emit('presentation-media-changed', {
      mediaUrl,
      mediaName,
      mediaType,
      presenterName,
    });
  });

  socket.on('stop-presentation-media', ({ roomId }) => {
    io.to(roomId).emit('presentation-media-changed', null);
  });
});

server.listen(PORT, () => {
  console.log(`[Server] OmniCall WebRTC platform running on port ${PORT}`);
});
