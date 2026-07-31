import { Router } from 'express';
import { AccessToken, RoomServiceClient } from 'livekit-server-sdk';
import { db, randomUUID } from './db.js';
import { requireAuth } from './auth.js';

const router = Router();
router.use(requireAuth);

const ACTIVE_LIVEKIT_KEY = 'APIWwmZh2HhPX7v';
const ACTIVE_LIVEKIT_SECRET = 'XiZynYs8Sh2ccQK9RNaIAl9DYb1HbjU8baw980oqnjD';
const ACTIVE_LIVEKIT_URL = 'wss://omnicall-gfhd6nn2.livekit.cloud';

function getLiveKitCredentials() {
  let apiKey = (process.env.LIVEKIT_API_KEY || '').trim();
  let apiSecret = (process.env.LIVEKIT_API_SECRET || '').trim();
  let rawUrl = (process.env.LIVEKIT_URL || '').trim();

  if (!apiKey || apiKey.length < 5 || apiKey.includes('xxxx')) apiKey = ACTIVE_LIVEKIT_KEY;
  if (!apiSecret || apiSecret.length < 20 || apiSecret.includes('xxxx')) apiSecret = ACTIVE_LIVEKIT_SECRET;
  if (!rawUrl || rawUrl.includes('xxxx') || !rawUrl.includes('omnicall-gfhd6nn2')) rawUrl = ACTIVE_LIVEKIT_URL;

  if (!rawUrl.startsWith('wss://') && !rawUrl.startsWith('ws://')) {
    rawUrl = `wss://${rawUrl.replace(/^https?:\/\//, '')}`;
  }
  const httpUrl = rawUrl.replace('wss://', 'https://').replace('ws://', 'http://');
  return { apiKey, apiSecret, rawUrl, httpUrl };
}

async function isMember(roomId, userId) {
  const row = await db.queryGet('SELECT 1 FROM room_members WHERE room_id = ? AND user_id = ?', [roomId, userId]);
  return !!row;
}

// LiveKit Diagnostic Endpoint to verify credentials against LiveKit Cloud
router.get('/debug-livekit', async (req, res) => {
  const { apiKey, apiSecret, httpUrl } = getLiveKitCredentials();

  try {
    const roomService = new RoomServiceClient(httpUrl, apiKey, apiSecret);
    const liveRooms = await roomService.listRooms();
    res.json({
      ok: true,
      apiKeyPrefix: `${apiKey.slice(0, 6)}...`,
      apiSecretLength: apiSecret.length,
      liveRoomsCount: liveRooms.length,
    });
  } catch (err) {
    console.error('[LiveKit Debug Error]:', err.message);
    res.status(400).json({
      ok: false,
      apiKeyPrefix: `${apiKey.slice(0, 6)}...`,
      apiSecretLength: apiSecret.length,
      error: err.message,
    });
  }
});

// Create a room. Creator becomes owner and first member.
router.post('/', async (req, res) => {
  const { name } = req.body || {};
  if (!name || !name.trim() || name.length > 80) {
    return res.status(400).json({ error: 'Room name is required (max 80 characters)' });
  }

  const id = randomUUID();
  try {
    await db.queryRun('INSERT INTO rooms (id, name, owner_id) VALUES (?, ?, ?)', [id, name.trim(), req.user.id]);
    await db.queryRun('INSERT INTO room_members (room_id, user_id, role) VALUES (?, ?, ?)', [id, req.user.id, 'owner']);
    res.status(201).json({ id, name: name.trim(), owner_id: req.user.id, role: 'owner' });
  } catch (err) {
    console.error('Create room failed:', err);
    res.status(500).json({ error: 'Failed to create room' });
  }
});

// List rooms the current user is a member of.
router.get('/', async (req, res) => {
  try {
    const rooms = await db.queryAll(
      `SELECT rooms.id, rooms.name, rooms.owner_id, room_members.role, rooms.created_at
       FROM rooms
       JOIN room_members ON room_members.room_id = rooms.id
       WHERE room_members.user_id = ?
       ORDER BY rooms.created_at DESC`,
      [req.user.id]
    );

    res.json({ rooms });
  } catch (err) {
    console.error('List rooms failed:', err);
    res.status(500).json({ error: 'Failed to list rooms' });
  }
});

// Add an existing user (by email) to a room. Owner only.
router.post('/:roomId/invite', async (req, res) => {
  const { roomId } = req.params;
  const { email } = req.body || {};

  try {
    const room = await db.queryGet('SELECT * FROM rooms WHERE id = ?', [roomId]);
    if (!room) return res.status(404).json({ error: 'Room not found' });
    if (room.owner_id !== req.user.id) {
      return res.status(403).json({ error: 'Only the room owner can invite members' });
    }
    if (!email) return res.status(400).json({ error: 'Email is required' });

    const invitee = await db.queryGet('SELECT * FROM users WHERE email = ?', [email.toLowerCase().trim()]);
    if (!invitee) {
      return res.status(404).json({ error: 'No account found with that email. Please ask them to sign up first.' });
    }

    const existingMember = await db.queryGet('SELECT 1 FROM room_members WHERE room_id = ? AND user_id = ?', [roomId, invitee.id]);
    if (!existingMember) {
      await db.queryRun('INSERT INTO room_members (room_id, user_id, role) VALUES (?, ?, ?)', [roomId, invitee.id, 'member']);
    }

    if (req.app.get('io')) {
      const io = req.app.get('io');
      io.emit('room-invited-notice', { inviteeUserId: invitee.id, roomId, roomName: room.name });
    }

    res.json({ ok: true, member: { id: invitee.id, email: invitee.email, name: invitee.name } });
  } catch (err) {
    console.error('Invite user failed:', err);
    res.status(500).json({ error: 'Failed to invite user to room' });
  }
});

// Issue a LiveKit access token — with unique identity & active credentials
router.post('/:roomId/token', async (req, res) => {
  const { roomId } = req.params;
  const { displayName } = req.body || {};
  const { apiKey, apiSecret } = getLiveKitCredentials();

  if (!apiKey || !apiSecret) {
    console.error('Server missing LIVEKIT_API_KEY or LIVEKIT_API_SECRET!');
    return res.status(500).json({ error: 'Server is missing LiveKit credentials.' });
  }

  try {
    const room = await db.queryGet('SELECT * FROM rooms WHERE id = ?', [roomId]);
    if (!room) return res.status(404).json({ error: 'Room not found' });

    const memberCheck = await isMember(roomId, req.user.id);
    if (!memberCheck) {
      return res.status(403).json({ error: 'You are not a member of this room' });
    }

    const effectiveName = (displayName && displayName.trim()) ? displayName.trim().slice(0, 50) : req.user.name;
    const uniqueIdentity = `${req.user.id}_${Date.now()}`;

    const at = new AccessToken(apiKey, apiSecret, {
      identity: uniqueIdentity,
      name: effectiveName,
      ttl: '2h',
    });

    at.addGrant({
      roomJoin: true,
      room: roomId,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    });

    const token = await at.toJwt();
    res.json({ token, roomName: room.name, roomId: room.id, displayName: effectiveName });
  } catch (err) {
    console.error('Failed to mint call token:', err);
    res.status(500).json({ error: 'Failed to create access token: ' + err.message });
  }
});

export default router;
