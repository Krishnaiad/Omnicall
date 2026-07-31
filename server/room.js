import { Router } from 'express';
import { AccessToken } from 'livekit-server-sdk';
import { db, randomUUID } from './db.js';
import { requireAuth } from './auth.js';

const router = Router();
router.use(requireAuth);

function isMember(roomId, userId) {
  return !!db.prepare('SELECT 1 FROM room_members WHERE room_id = ? AND user_id = ?').get(roomId, userId);
}

// Create a room. Creator becomes owner and first member.
router.post('/', (req, res) => {
  const { name } = req.body || {};
  if (!name || !name.trim() || name.length > 80) {
    return res.status(400).json({ error: 'Room name is required (max 80 characters)' });
  }

  const id = randomUUID();
  try {
    db.exec('BEGIN TRANSACTION');
    db.prepare('INSERT INTO rooms (id, name, owner_id) VALUES (?, ?, ?)').run(id, name.trim(), req.user.id);
    db.prepare('INSERT INTO room_members (room_id, user_id, role) VALUES (?, ?, ?)').run(id, req.user.id, 'owner');
    db.exec('COMMIT');
    res.status(201).json({ id, name: name.trim(), owner_id: req.user.id, role: 'owner' });
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch {}
    console.error('Create room failed:', err);
    res.status(500).json({ error: 'Failed to create room' });
  }
});

// List rooms the current user is a member of.
router.get('/', (req, res) => {
  const rooms = db
    .prepare(
      `SELECT rooms.id, rooms.name, rooms.owner_id, room_members.role, rooms.created_at
       FROM rooms
       JOIN room_members ON room_members.room_id = rooms.id
       WHERE room_members.user_id = ?
       ORDER BY rooms.created_at DESC`
    )
    .all(req.user.id);

  res.json({ rooms });
});

// Add an existing user (by email) to a room. Owner only.
router.post('/:roomId/invite', (req, res) => {
  const { roomId } = req.params;
  const { email } = req.body || {};

  const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(roomId);
  if (!room) return res.status(404).json({ error: 'Room not found' });
  if (room.owner_id !== req.user.id) {
    return res.status(403).json({ error: 'Only the room owner can invite members' });
  }
  if (!email) return res.status(400).json({ error: 'Email is required' });

  const invitee = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase().trim());
  if (!invitee) {
    return res.status(404).json({ error: 'No account found with that email. Please ask them to sign up first.' });
  }

  db.prepare('INSERT OR IGNORE INTO room_members (room_id, user_id, role) VALUES (?, ?, ?)').run(
    roomId,
    invitee.id,
    'member'
  );

  res.json({ ok: true, member: { id: invitee.id, email: invitee.email, name: invitee.name } });
});

// Issue a LiveKit access token — with unique identity + custom display name
router.post('/:roomId/token', async (req, res) => {
  const { roomId } = req.params;
  const { displayName } = req.body || {};
  const { LIVEKIT_API_KEY, LIVEKIT_API_SECRET } = process.env;

  const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(roomId);
  if (!room) return res.status(404).json({ error: 'Room not found' });
  if (!isMember(roomId, req.user.id)) {
    return res.status(403).json({ error: 'You are not a member of this room' });
  }
  if (!LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
    return res.status(500).json({ error: 'Server is missing LiveKit credentials' });
  }

  const effectiveName = (displayName && displayName.trim()) ? displayName.trim().slice(0, 50) : req.user.name;
  // Ensure participant identity is unique per user to prevent collision errors
  const uniqueIdentity = `${req.user.id}_${effectiveName}`;

  try {
    const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
      identity: uniqueIdentity,
      name: effectiveName,
      ttl: '30m',
    });
    at.addGrant({ roomJoin: true, room: roomId, canPublish: true, canSubscribe: true });

    const token = await at.toJwt();
    res.json({ token, roomName: room.name, roomId: room.id, displayName: effectiveName });
  } catch (err) {
    console.error('Failed to mint call token:', err);
    res.status(500).json({ error: 'Failed to create access token' });
  }
});

export default router;
