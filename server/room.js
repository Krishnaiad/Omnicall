import { Router } from 'express';
import { AccessToken, RoomServiceClient } from 'livekit-server-sdk';
import { db, randomUUID } from './db.js';
import { requireAuth } from './auth.js';
import { notifyUser } from './notifications.js';

const router = Router();
router.use(requireAuth);

function getLiveKitCredentials() {
  const apiKey = (process.env.LIVEKIT_API_KEY || '').trim();
  const apiSecret = (process.env.LIVEKIT_API_SECRET || '').trim();
  let rawUrl = (process.env.LIVEKIT_URL || '').trim();

  if (rawUrl && !rawUrl.startsWith('wss://') && !rawUrl.startsWith('ws://')) {
    rawUrl = `wss://${rawUrl.replace(/^https?:\/\//, '')}`;
  }
  const httpUrl = rawUrl ? rawUrl.replace('wss://', 'https://').replace('ws://', 'http://') : '';
  return { apiKey, apiSecret, rawUrl, httpUrl };
}

async function isMember(roomId, userId) {
  const row = await db.queryGet('SELECT 1 FROM room_members WHERE room_id = ? AND user_id = ?', [roomId, userId]);
  return !!row;
}

// LiveKit Diagnostic Endpoint to verify credentials against LiveKit Cloud
router.get('/debug-livekit', async (req, res) => {
  const { apiKey, apiSecret, httpUrl } = getLiveKitCredentials();

  if (!apiKey || !apiSecret || !httpUrl) {
    return res.status(500).json({ ok: false, error: 'Server missing LIVEKIT_API_KEY, LIVEKIT_API_SECRET, or LIVEKIT_URL in environment' });
  }

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

// Search users by username or email for in-call invites
router.get('/search-users', async (req, res) => {
  const q = (req.query.q || '').trim().toLowerCase();
  if (!q) return res.json({ users: [] });

  try {
    const users = await db.queryAll(
      `SELECT id, username, name, email FROM users 
       WHERE (LOWER(username) LIKE ? OR LOWER(name) LIKE ? OR LOWER(email) LIKE ?) 
       AND id != ?
       LIMIT 10`,
      [`%${q}%`, `%${q}%`, `%${q}%`, req.user.id]
    );
    res.json({ users });
  } catch (err) {
    console.error('Search users failed:', err);
    res.status(500).json({ error: 'Failed to search users' });
  }
});

// Create a room. Enforces unique room names per creator.
router.post('/', async (req, res) => {
  const { name } = req.body || {};
  if (!name || !name.trim() || name.length > 80) {
    return res.status(400).json({ error: 'Room name is required (max 80 characters)' });
  }

  const trimmedName = name.trim();

  try {
    const existing = await db.queryGet(
      'SELECT 1 FROM rooms WHERE owner_id = ? AND LOWER(name) = LOWER(?)',
      [req.user.id, trimmedName]
    );
    if (existing) {
      return res.status(400).json({ error: `You already have a room named "${trimmedName}". Please choose a unique room name.` });
    }

    const id = randomUUID();
    await db.queryRun('INSERT INTO rooms (id, name, owner_id) VALUES (?, ?, ?)', [id, trimmedName, req.user.id]);
    await db.queryRun('INSERT INTO room_members (room_id, user_id, role) VALUES (?, ?, ?)', [id, req.user.id, 'owner']);
    res.status(201).json({ id, name: trimmedName, owner_id: req.user.id, role: 'owner' });
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

// Fetch persistent chat messages for a room
router.get('/:roomId/messages', async (req, res) => {
  const { roomId } = req.params;
  try {
    const memberCheck = await isMember(roomId, req.user.id);
    if (!memberCheck) return res.status(403).json({ error: 'Access denied' });

    const rows = await db.queryAll(
      `SELECT id, sender_id as "senderId", sender_name as "senderName", message as text, created_at as timestamp
       FROM chat_messages
       WHERE room_id = ?
       ORDER BY created_at ASC`,
      [roomId]
    );

    res.json({ messages: rows });
  } catch (err) {
    console.error('Fetch chat messages failed:', err);
    res.status(500).json({ error: 'Failed to load chat history' });
  }
});

// Save persistent chat message sent during a call
router.post('/:roomId/messages', async (req, res) => {
  const { roomId } = req.params;
  const { id, text } = req.body || {};

  if (!text || !text.trim()) {
    return res.status(400).json({ error: 'Message text is required' });
  }

  try {
    const memberCheck = await isMember(roomId, req.user.id);
    if (!memberCheck) return res.status(403).json({ error: 'Access denied' });

    const msgId = id || randomUUID();
    const sanitized = text.trim().slice(0, 1000);

    await db.queryRun(
      'INSERT INTO chat_messages (id, room_id, sender_id, sender_name, message) VALUES (?, ?, ?, ?, ?)',
      [msgId, roomId, req.user.id, req.user.name, sanitized]
    );

    res.status(201).json({
      id: msgId,
      roomId,
      senderId: req.user.id,
      senderName: req.user.name,
      text: sanitized,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('Save chat message failed:', err);
    res.status(500).json({ error: 'Failed to save chat message' });
  }
});

// Invite a user by Username OR Email. Owner only.
router.post('/:roomId/invite', async (req, res) => {
  const { roomId } = req.params;
  const { query, email, username } = req.body || {};
  const searchTerm = (query || username || email || '').trim().toLowerCase();

  try {
    const room = await db.queryGet('SELECT * FROM rooms WHERE id = ?', [roomId]);
    if (!room) return res.status(404).json({ error: 'Room not found' });
    if (room.owner_id !== req.user.id) {
      return res.status(403).json({ error: 'Only the room owner can invite members' });
    }
    if (!searchTerm) return res.status(400).json({ error: 'Username or email is required' });

    const invitee = await db.queryGet(
      'SELECT * FROM users WHERE LOWER(username) = ? OR LOWER(email) = ?',
      [searchTerm, searchTerm]
    );

    if (!invitee) {
      return res.status(404).json({ error: `No user found matching "${searchTerm}". Please check the username/email.` });
    }

    const existingMember = await db.queryGet('SELECT 1 FROM room_members WHERE room_id = ? AND user_id = ?', [roomId, invitee.id]);
    if (!existingMember) {
      await db.queryRun('INSERT INTO room_members (room_id, user_id, role) VALUES (?, ?, ?)', [roomId, invitee.id, 'member']);
    }

    // Trigger instant real-time Server-Sent Event (SSE) notification to invitee's Dashboard
    notifyUser(invitee.id, {
      type: 'ROOM_INVITED',
      roomId,
      roomName: room.name,
      invitedBy: req.user.name,
      timestamp: new Date().toISOString(),
    });

    res.json({ ok: true, member: { id: invitee.id, username: invitee.username, email: invitee.email, name: invitee.name } });
  } catch (err) {
    console.error('Invite user failed:', err);
    res.status(500).json({ error: 'Failed to invite user to room' });
  }
});

// Bulletproof Delete Room (Owner Only)
router.delete('/:roomId', async (req, res) => {
  const { roomId } = req.params;

  try {
    const room = await db.queryGet('SELECT * FROM rooms WHERE id = ?', [roomId]);
    if (!room) return res.status(404).json({ error: 'Room not found' });
    if (room.owner_id !== req.user.id) {
      return res.status(403).json({ error: 'Only the room owner can delete this room' });
    }

    try { await db.queryRun('DELETE FROM chat_messages WHERE room_id = ?', [roomId]); } catch (_) {}
    try { await db.queryRun('DELETE FROM room_members WHERE room_id = ?', [roomId]); } catch (_) {}
    await db.queryRun('DELETE FROM rooms WHERE id = ?', [roomId]);

    res.json({ ok: true, message: 'Room deleted successfully' });
  } catch (err) {
    console.error('Delete room failed:', err);
    res.status(500).json({ error: 'Failed to delete room: ' + err.message });
  }
});

// Bulletproof Leave Room (Member Only)
router.delete('/:roomId/leave', async (req, res) => {
  const { roomId } = req.params;

  try {
    const room = await db.queryGet('SELECT * FROM rooms WHERE id = ?', [roomId]);
    if (!room) return res.status(404).json({ error: 'Room not found' });
    if (room.owner_id === req.user.id) {
      return res.status(400).json({ error: 'Room owner cannot leave the room. Use Delete Room instead.' });
    }

    await db.queryRun('DELETE FROM room_members WHERE room_id = ? AND user_id = ?', [roomId, req.user.id]);
    res.json({ ok: true, message: 'Left room successfully' });
  } catch (err) {
    console.error('Leave room failed:', err);
    res.status(500).json({ error: 'Failed to leave room: ' + err.message });
  }
});

// Issue a LiveKit access token — role metadata embedded for SFU-side role awareness (Point 9 fix)
router.post('/:roomId/token', async (req, res) => {
  const { roomId } = req.params;
  const { displayName } = req.body || {};
  const { apiKey, apiSecret } = getLiveKitCredentials();

  if (!apiKey || !apiSecret) {
    console.error('Server missing LIVEKIT_API_KEY or LIVEKIT_API_SECRET in environment!');
    return res.status(500).json({ error: 'Server is missing LiveKit credentials.' });
  }

  try {
    const room = await db.queryGet('SELECT * FROM rooms WHERE id = ?', [roomId]);
    if (!room) return res.status(404).json({ error: 'Room not found' });

    const memberCheck = await db.queryGet(
      'SELECT role FROM room_members WHERE room_id = ? AND user_id = ?',
      [roomId, req.user.id]
    );
    if (!memberCheck) {
      return res.status(403).json({ error: 'You are not a member of this room' });
    }

    const isOwner = room.owner_id === req.user.id;
    const participantRole = isOwner ? 'owner' : (memberCheck.role || 'member');
    const effectiveName = (displayName && displayName.trim()) ? displayName.trim().slice(0, 50) : req.user.name;

    const at = new AccessToken(apiKey, apiSecret, {
      identity: req.user.id,
      name: effectiveName,
      ttl: '2h',
      // Embed role in participant metadata so all SFU clients know the role without querying DB
      metadata: JSON.stringify({
        role: participantRole,
        isHost: isOwner,
        userId: req.user.id,
        username: req.user.username || '',
      }),
    });

    at.addGrant({
      roomJoin: true,
      room: roomId,
      canPublish: true,       // All members can publish camera/mic/screen
      canSubscribe: true,
      canPublishData: true,   // Required for in-call DataPackets (chat, signals)
    });

    const token = await at.toJwt();
    res.json({ token, roomName: room.name, roomId: room.id, displayName: effectiveName, role: participantRole });
  } catch (err) {
    console.error('Failed to mint call token:', err);
    res.status(500).json({ error: 'Failed to create access token: ' + err.message });
  }
});

// Reconciliation endpoint — diffs live_sessions (DB) vs LiveKit SFU state (Point 1 fix)
// Shows who the DB thinks is in the room vs who LiveKit actually reports
router.get('/:roomId/live-status', async (req, res) => {
  const { roomId } = req.params;
  const { apiKey, apiSecret, httpUrl } = getLiveKitCredentials();

  try {
    const room = await db.queryGet('SELECT * FROM rooms WHERE id = ?', [roomId]);
    if (!room) return res.status(404).json({ error: 'Room not found' });

    const memberCheck = await isMember(roomId, req.user.id);
    if (!memberCheck) return res.status(403).json({ error: 'Access denied' });

    // DB perspective: who's in live_sessions with no left_at
    const dbActiveSessions = await db.queryAll(
      'SELECT participant_identity, participant_name, joined_at FROM live_sessions WHERE room_id = ? AND left_at IS NULL',
      [roomId]
    );

    // LiveKit SFU perspective: who's actually connected right now
    let livekitParticipants = [];
    if (apiKey && apiSecret && httpUrl) {
      try {
        const { RoomServiceClient } = await import('livekit-server-sdk');
        const roomService = new RoomServiceClient(httpUrl, apiKey, apiSecret);
        livekitParticipants = await roomService.listParticipants(roomId);
      } catch (err) {
        console.warn('[Reconcile] LiveKit listParticipants failed:', err.message);
      }
    }

    const livekitIdentities = new Set(livekitParticipants.map((p) => p.identity));
    const dbIdentities = new Set(dbActiveSessions.map((s) => s.participant_identity));

    const zombieRows = dbActiveSessions.filter((s) => !livekitIdentities.has(s.participant_identity));
    const phantomParticipants = livekitParticipants.filter((p) => !dbIdentities.has(p.identity));

    // Auto-close zombie sessions found during reconciliation
    for (const zombie of zombieRows) {
      await db.queryRun(
        'UPDATE live_sessions SET left_at = NOW(), disconnect_reason = ? WHERE room_id = ? AND participant_identity = ? AND left_at IS NULL',
        ['reconciled_stale', roomId, zombie.participant_identity]
      ).catch(() => {});
    }

    res.json({
      roomId,
      roomName: room.name,
      dbActiveSessions: dbActiveSessions.length,
      livekitActive: livekitParticipants.length,
      zombieRowsCleaned: zombieRows.length,
      phantomParticipants: phantomParticipants.length,
      drift: zombieRows.length + phantomParticipants.length,
      reconciled: true,
    });
  } catch (err) {
    console.error('Live status reconciliation failed:', err);
    res.status(500).json({ error: 'Reconciliation failed: ' + err.message });
  }
});

export default router;

