import { Router } from 'express';
import { AccessToken, RoomServiceClient } from 'livekit-server-sdk';
import { db, randomUUID } from './db.js';
import { requireAuth, requireAdmin } from './auth.js';
import { notifyUser } from './notifications.js';

const router = Router();

// ─── Public Guest Join & Preview Endpoints (No Login Required) ─────────────
router.get('/join-preview/:token', async (req, res) => {
  const { token } = req.params;
  try {
    const link = await db.queryGet('SELECT * FROM invite_links WHERE token = $1', [token]);
    if (!link) return res.status(404).json({ error: 'Invite link is invalid or has expired' });

    const room = await db.queryGet('SELECT id, name, owner_id FROM rooms WHERE id = $1', [link.room_id]);
    if (!room) return res.status(404).json({ error: 'Associated room was not found' });

    const owner = await db.queryGet('SELECT name, username FROM users WHERE id = $1', [room.owner_id]);

    res.json({
      ok: true,
      roomId: room.id,
      roomName: room.name,
      hostName: owner?.name || 'Room Creator',
      inviteToken: token,
    });
  } catch (err) {
    console.error('Join preview failed:', err);
    res.status(500).json({ error: 'Failed to inspect invite link' });
  }
});

router.post('/guest-join/:token', async (req, res) => {
  const { token } = req.params;
  const { guestName } = req.body || {};

  if (!guestName || !guestName.trim()) {
    return res.status(400).json({ error: 'Please enter a display name to join the call' });
  }

  const cleanName = `${guestName.trim().slice(0, 30)} (Guest)`;
  const guestUserId = `guest_${randomUUID().replace(/-/g, '').slice(0, 12)}`;

  try {
    const link = await db.queryGet('SELECT * FROM invite_links WHERE token = $1', [token]);
    if (!link) return res.status(404).json({ error: 'Invite link is invalid or expired' });

    const room = await db.queryGet('SELECT id, name FROM rooms WHERE id = $1', [link.room_id]);
    if (!room) return res.status(404).json({ error: 'Room not found' });

    const { apiKey, apiSecret } = getLiveKitCredentials();
    if (!apiKey || !apiSecret) {
      return res.status(500).json({ error: 'Server missing LiveKit credentials' });
    }

    const guestUser = {
      id: guestUserId,
      name: cleanName,
      username: 'guest',
      role: 'guest',
    };

    // 1. Generate LiveKit Video Token
    const at = new AccessToken(apiKey, apiSecret, {
      identity: guestUser.id,
      name: guestUser.name,
      ttl: '2h',
      metadata: JSON.stringify({
        role: 'guest',
        isHost: false,
        isGuest: true,
        userId: guestUser.id,
        username: guestUser.username,
      }),
    });

    at.addGrant({
      roomJoin: true,
      room: room.id,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    });

    const liveKitToken = await at.toJwt();

    // 2. Generate Application JWT (For Chat/Whiteboard REST API calls)
    const { signAccessToken } = await import('./auth.js');
    const appJwtToken = signAccessToken(guestUser);

    // 3. Add to room_members table so isMember() checks pass
    await db.queryRun(
      'INSERT INTO room_members (room_id, user_id, role) VALUES ($1, $2, $3)',
      [room.id, guestUser.id, 'guest']
    ).catch(() => {}); // Ignore duplicate if they somehow rejoin with same ID

    res.json({
      ok: true,
      token: appJwtToken,         // Used by App.jsx for API authorization
      roomToken: liveKitToken,    // Used by CallScreen.jsx for LiveKit WebSocket
      roomName: room.name,
      roomId: room.id,
      displayName: guestUser.name,
      role: 'guest',
      isGuest: true,
      guestUser: guestUser,
    });
  } catch (err) {
    console.error('Guest join failed:', err);
    res.status(500).json({ error: 'Failed to generate guest access: ' + err.message });
  }
});


// All routes below require authenticated user account
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
  const row = await db.queryGet('SELECT 1 FROM room_members WHERE room_id = $1 AND user_id = $2', [roomId, userId]);
  return !!row;
}

// LiveKit Diagnostic Endpoint to verify credentials against LiveKit Cloud (Admin Only)
router.get('/debug-livekit', requireAdmin, async (req, res) => {
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
       WHERE (LOWER(username) LIKE $1 OR LOWER(name) LIKE $2 OR LOWER(email) LIKE $3) 
       AND id != $4
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
      'SELECT 1 FROM rooms WHERE owner_id = $1 AND LOWER(name) = LOWER($2)',
      [req.user.id, trimmedName]
    );
    if (existing) {
      return res.status(400).json({ error: `You already have a room named "${trimmedName}". Please choose a unique room name.` });
    }

    const id = randomUUID();
    await db.queryRun('INSERT INTO rooms (id, name, owner_id) VALUES ($1, $2, $3)', [id, trimmedName, req.user.id]);
    await db.queryRun('INSERT INTO room_members (room_id, user_id, role) VALUES ($1, $2, $3)', [id, req.user.id, 'owner']);
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
      `SELECT rooms.id, rooms.name, rooms.owner_id, room_members.role, rooms.created_at,
        (SELECT COUNT(*)::int FROM live_sessions WHERE (room_id = rooms.id OR room_name = rooms.name) AND left_at IS NULL) AS active_count
       FROM rooms
       JOIN room_members ON room_members.room_id = rooms.id
       WHERE room_members.user_id = $1
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
       WHERE room_id = $1
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
      'INSERT INTO chat_messages (id, room_id, sender_id, sender_name, message) VALUES ($1, $2, $3, $4, $5)',
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
    const room = await db.queryGet('SELECT * FROM rooms WHERE id = $1', [roomId]);
    if (!room) return res.status(404).json({ error: 'Room not found' });
    if (room.owner_id !== req.user.id) {
      return res.status(403).json({ error: 'Only the room owner can invite members' });
    }
    if (!searchTerm) return res.status(400).json({ error: 'Username or email is required' });

    const invitee = await db.queryGet(
      'SELECT * FROM users WHERE LOWER(username) = $1 OR LOWER(email) = $2',
      [searchTerm, searchTerm]
    );

    if (!invitee) {
      return res.status(404).json({ error: `No user found matching "${searchTerm}". Please check the username/email.` });
    }

    const existingMember = await db.queryGet('SELECT 1 FROM room_members WHERE room_id = $1 AND user_id = $2', [roomId, invitee.id]);
    if (!existingMember) {
      await db.queryRun('INSERT INTO room_members (room_id, user_id, role) VALUES ($1, $2, $3)', [roomId, invitee.id, 'member']);
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

// End Meeting for Everyone (Host Only) — Active SFU Disconnect + DB Cleanup
router.post('/:roomId/end-meeting', async (req, res) => {
  const { roomId } = req.params;
  try {
    const room = await db.queryGet('SELECT * FROM rooms WHERE id = $1', [roomId]);
    if (!room) return res.status(404).json({ error: 'Room not found' });
    if (room.owner_id !== req.user.id) {
      return res.status(403).json({ error: 'Only the room creator can end the meeting for everyone' });
    }

    // 1. Close LiveKit SFU room actively if credentials present
    const { apiKey, apiSecret, httpUrl } = getLiveKitCredentials();
    if (apiKey && apiSecret && httpUrl) {
      try {
        const { RoomServiceClient } = await import('livekit-server-sdk');
        const roomService = new RoomServiceClient(httpUrl, apiKey, apiSecret);
        await roomService.deleteRoom(roomId).catch(() => {});
      } catch (err) {
        console.warn('[LiveKit SFU Teardown Notice]:', err.message);
      }
    }

    // 2. Mark all live_sessions as ended
    await db.queryRun(
      'UPDATE live_sessions SET left_at = CURRENT_TIMESTAMP, disconnect_reason = $1 WHERE room_id = $2 AND left_at IS NULL',
      ['host_ended_meeting', roomId]
    ).catch(() => {});


    res.json({ ok: true, message: 'Meeting ended successfully for all participants' });
  } catch (err) {
    console.error('End meeting failed:', err);
    res.status(500).json({ error: 'Failed to end meeting: ' + err.message });
  }
});

// Bulletproof Delete Room (Owner Only)
router.delete('/:roomId', async (req, res) => {
  const { roomId } = req.params;

  try {
    const room = await db.queryGet('SELECT * FROM rooms WHERE id = $1', [roomId]);
    if (!room) return res.status(404).json({ error: 'Room not found' });
    if (room.owner_id !== req.user.id) {
      return res.status(403).json({ error: 'Only the room owner can delete this room' });
    }

    // Delete from LiveKit SFU
    const { apiKey, apiSecret, httpUrl } = getLiveKitCredentials();
    if (apiKey && apiSecret && httpUrl) {
      try {
        const { RoomServiceClient } = await import('livekit-server-sdk');
        const roomService = new RoomServiceClient(httpUrl, apiKey, apiSecret);
        await roomService.deleteRoom(roomId).catch(() => {});
      } catch (_) {}
    }

    try { await db.queryRun('DELETE FROM chat_messages WHERE room_id = $1', [roomId]); } catch (_) {}
    try { await db.queryRun('DELETE FROM room_members WHERE room_id = $1', [roomId]); } catch (_) {}
    try { await db.queryRun('DELETE FROM hand_raises WHERE room_id = $1', [roomId]); } catch (_) {}
    try { await db.queryRun('DELETE FROM polls WHERE room_id = $1', [roomId]); } catch (_) {}
    try { await db.queryRun('DELETE FROM whiteboard_strokes WHERE room_id = $1', [roomId]); } catch (_) {}
    try { await db.queryRun('DELETE FROM invite_links WHERE room_id = $1', [roomId]); } catch (_) {}
    await db.queryRun('DELETE FROM rooms WHERE id = $1', [roomId]);

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
    const room = await db.queryGet('SELECT * FROM rooms WHERE id = $1', [roomId]);
    if (!room) return res.status(404).json({ error: 'Room not found' });
    if (room.owner_id === req.user.id) {
      return res.status(400).json({ error: 'Room owner cannot leave the room. Use Delete Room instead.' });
    }

    await db.queryRun('DELETE FROM room_members WHERE room_id = $1 AND user_id = $2', [roomId, req.user.id]);
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
    const room = await db.queryGet('SELECT * FROM rooms WHERE id = $1', [roomId]);
    if (!room) return res.status(404).json({ error: 'Room not found' });

    const memberCheck = await db.queryGet(
      'SELECT role FROM room_members WHERE room_id = $1 AND user_id = $2',
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
    const room = await db.queryGet('SELECT * FROM rooms WHERE id = $1', [roomId]);
    if (!room) return res.status(404).json({ error: 'Room not found' });

    const memberCheck = await isMember(roomId, req.user.id);
    if (!memberCheck) return res.status(403).json({ error: 'Access denied' });

    // DB perspective: who's in live_sessions with no left_at
    const dbActiveSessions = await db.queryAll(
      'SELECT participant_identity, participant_name, joined_at FROM live_sessions WHERE room_id = $1 AND left_at IS NULL',
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
        'UPDATE live_sessions SET left_at = NOW(), disconnect_reason = $1 WHERE room_id = $2 AND participant_identity = $3 AND left_at IS NULL',
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

// ══════════════════════════════════════════════════════════════════════════════
// ✋ ROOM STATE SERVICE: HAND RAISING (Feature 1 - Monotonic Ordered Queue)
// ══════════════════════════════════════════════════════════════════════════════

// Raise Hand (User calls — stamps monotonic sequence number on server)
router.post('/:roomId/raise-hand', async (req, res) => {
  const { roomId } = req.params;
  try {
    const memberCheck = await isMember(roomId, req.user.id);
    if (!memberCheck) return res.status(403).json({ error: 'Access denied' });

    // Determine next monotonic sequence number for queue ordering
    const maxRow = await db.queryGet(
      'SELECT COALESCE(MAX(sequence_num), 0) as max_seq FROM hand_raises WHERE room_id = $1',
      [roomId]
    );
    const nextSeq = (maxRow?.max_seq || 0) + 1;
    const raiseId = randomUUID();

    // Upsert hand raise row
    await db.queryRun(
      'DELETE FROM hand_raises WHERE room_id = $1 AND user_id = $2',
      [roomId, req.user.id]
    );
    await db.queryRun(
      'INSERT INTO hand_raises (id, room_id, user_id, user_name, sequence_num) VALUES ($1, $2, $3, $4, $5)',
      [raiseId, roomId, req.user.id, req.user.name, nextSeq]
    );

    res.json({
      ok: true,
      handRaise: {
        id: raiseId,
        roomId,
        userId: req.user.id,
        userName: req.user.name,
        sequenceNum: nextSeq,
        raisedAt: new Date().toISOString(),
      },
    });
  } catch (err) {
    console.error('Raise hand failed:', err);
    res.status(500).json({ error: 'Failed to raise hand' });
  }
});

// Lower Hand (Self or Host moderation: host can lower any participant's hand)
router.post('/:roomId/lower-hand', async (req, res) => {
  const { roomId } = req.params;
  const { targetUserId } = req.body || {};

  try {
    const room = await db.queryGet('SELECT owner_id FROM rooms WHERE id = $1', [roomId]);
    if (!room) return res.status(404).json({ error: 'Room not found' });

    const isHost = room.owner_id === req.user.id;
    const userToLower = (targetUserId && isHost) ? targetUserId : req.user.id;

    await db.queryRun('DELETE FROM hand_raises WHERE room_id = $1 AND user_id = $2', [roomId, userToLower]);
    res.json({ ok: true, loweredUserId: userToLower });
  } catch (err) {
    console.error('Lower hand failed:', err);
    res.status(500).json({ error: 'Failed to lower hand' });
  }
});

// Get Active Hand Raise Queue (Late-joiner state recovery)
router.get('/:roomId/hand-raises', async (req, res) => {
  const { roomId } = req.params;
  try {
    const memberCheck = await isMember(roomId, req.user.id);
    if (!memberCheck) return res.status(403).json({ error: 'Access denied' });

    const rows = await db.queryAll(
      `SELECT id, user_id as "userId", user_name as "userName", sequence_num as "sequenceNum", raised_at as "raisedAt"
       FROM hand_raises
       WHERE room_id = $1
       ORDER BY sequence_num ASC, raised_at ASC`,
      [roomId]
    );

    res.json({ handRaises: rows });
  } catch (err) {
    console.error('Fetch hand raises failed:', err);
    res.status(500).json({ error: 'Failed to load hand raise queue' });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// 📊 ROOM STATE SERVICE: POLLS & Q&A (Feature 2 - Server Authoritative Tally)
// ══════════════════════════════════════════════════════════════════════════════

// Create Poll (Host-Gated on Server)
router.post('/:roomId/polls', async (req, res) => {
  const { roomId } = req.params;
  const { question, options } = req.body || {};

  if (!question || !question.trim()) {
    return res.status(400).json({ error: 'Poll question is required' });
  }
  if (!Array.isArray(options) || options.length < 2) {
    return res.status(400).json({ error: 'At least 2 poll options are required' });
  }

  try {
    const room = await db.queryGet('SELECT owner_id FROM rooms WHERE id = $1', [roomId]);
    if (!room) return res.status(404).json({ error: 'Room not found' });
    if (room.owner_id !== req.user.id) {
      return res.status(403).json({ error: 'Only the room host can launch polls' });
    }

    const pollId = randomUUID();
    const cleanOptions = options.map((opt) => String(opt).trim()).filter(Boolean);

    await db.queryRun(
      'INSERT INTO polls (id, room_id, creator_id, creator_name, question, options_json, status) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [pollId, roomId, req.user.id, req.user.name, question.trim(), JSON.stringify(cleanOptions), 'active']
    );

    res.status(201).json({
      ok: true,
      poll: {
        id: pollId,
        roomId,
        creatorId: req.user.id,
        creatorName: req.user.name,
        question: question.trim(),
        options: cleanOptions,
        status: 'active',
        votes: {},
        totalVotes: 0,
        createdAt: new Date().toISOString(),
      },
    });
  } catch (err) {
    console.error('Create poll failed:', err);
    res.status(500).json({ error: 'Failed to launch poll' });
  }
});

// Vote in Poll (Server-Side Unique Constraint Enforces 1 Vote Per User)
router.post('/:roomId/polls/:pollId/vote', async (req, res) => {
  const { roomId, pollId } = req.params;
  const { optionIndex } = req.body || {};

  if (typeof optionIndex !== 'number' || optionIndex < 0) {
    return res.status(400).json({ error: 'Valid option index is required' });
  }

  try {
    const memberCheck = await isMember(roomId, req.user.id);
    if (!memberCheck) return res.status(403).json({ error: 'Access denied' });

    const poll = await db.queryGet('SELECT * FROM polls WHERE id = $1 AND room_id = $2', [pollId, roomId]);
    if (!poll) return res.status(404).json({ error: 'Poll not found' });
    if (poll.status !== 'active') return res.status(400).json({ error: 'This poll is already closed' });

    const voteId = randomUUID();
    // Delete prior vote if any, then insert new vote
    await db.queryRun('DELETE FROM poll_votes WHERE poll_id = $1 AND user_id = $2', [pollId, req.user.id]);
    await db.queryRun(
      'INSERT INTO poll_votes (id, poll_id, user_id, user_name, option_index) VALUES ($1, $2, $3, $4, $5)',
      [voteId, pollId, req.user.id, req.user.name, optionIndex]
    );

    // Compute updated authoritative tally
    const voteRows = await db.queryAll('SELECT option_index FROM poll_votes WHERE poll_id = $1', [pollId]);
    const tally = {};
    for (const v of voteRows) {
      tally[v.option_index] = (tally[v.option_index] || 0) + 1;
    }

    res.json({
      ok: true,
      pollId,
      userVotedOption: optionIndex,
      votes: tally,
      totalVotes: voteRows.length,
    });
  } catch (err) {
    console.error('Vote failed:', err);
    res.status(500).json({ error: 'Failed to record vote' });
  }
});

// Close Poll (Host-Only)
router.post('/:roomId/polls/:pollId/close', async (req, res) => {
  const { roomId, pollId } = req.params;
  try {
    const room = await db.queryGet('SELECT owner_id FROM rooms WHERE id = $1', [roomId]);
    if (!room || room.owner_id !== req.user.id) {
      return res.status(403).json({ error: 'Only the room host can close polls' });
    }

    await db.queryRun("UPDATE polls SET status = 'closed' WHERE id = $1 AND room_id = $2", [pollId, roomId]);
    res.json({ ok: true, pollId, status: 'closed' });
  } catch (err) {
    console.error('Close poll failed:', err);
    res.status(500).json({ error: 'Failed to close poll' });
  }
});

// List Polls with Authoritative Vote Counts (Late-Joiner State Recovery)
router.get('/:roomId/polls', async (req, res) => {
  const { roomId } = req.params;
  try {
    const memberCheck = await isMember(roomId, req.user.id);
    if (!memberCheck) return res.status(403).json({ error: 'Access denied' });

    const pollRows = await db.queryAll('SELECT * FROM polls WHERE room_id = $1 ORDER BY created_at DESC', [roomId]);
    const pollsWithTally = await Promise.all(
      pollRows.map(async (p) => {
        let options = [];
        try { options = JSON.parse(p.options_json); } catch {}

        const voteRows = await db.queryAll('SELECT user_id, option_index FROM poll_votes WHERE poll_id = $1', [p.id]);
        const tally = {};
        let myVote = null;
        for (const v of voteRows) {
          tally[v.option_index] = (tally[v.option_index] || 0) + 1;
          if (v.user_id === req.user.id) myVote = v.option_index;
        }

        return {
          id: p.id,
          roomId: p.room_id,
          creatorId: p.creator_id,
          creatorName: p.creator_name,
          question: p.question,
          options,
          status: p.status,
          votes: tally,
          totalVotes: voteRows.length,
          userVotedOption: myVote,
          createdAt: p.created_at,
        };
      })
    );

    res.json({ polls: pollsWithTally });
  } catch (err) {
    console.error('Fetch polls failed:', err);
    res.status(500).json({ error: 'Failed to load polls' });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// 🎨 ROOM STATE SERVICE: WHITEBOARD (Feature 3 - Append-Only Canvas History)
// ══════════════════════════════════════════════════════════════════════════════

// Save Stroke (Persist-First Before Broadcast)
router.post('/:roomId/whiteboard/strokes', async (req, res) => {
  const { roomId } = req.params;
  const { stroke } = req.body || {};

  if (!stroke) return res.status(400).json({ error: 'Stroke data is required' });

  try {
    const memberCheck = await isMember(roomId, req.user.id);
    if (!memberCheck) return res.status(403).json({ error: 'Access denied' });

    const strokeId = randomUUID();
    await db.queryRun(
      'INSERT INTO whiteboard_strokes (id, room_id, user_id, stroke_data) VALUES ($1, $2, $3, $4)',
      [strokeId, roomId, req.user.id, JSON.stringify(stroke)]
    );

    res.status(201).json({ ok: true, id: strokeId });
  } catch (err) {
    console.error('Save stroke failed:', err);
    res.status(500).json({ error: 'Failed to save whiteboard stroke' });
  }
});

// Fetch Full Whiteboard Canvas History (Late-Joiner State Recovery)
router.get('/:roomId/whiteboard', async (req, res) => {
  const { roomId } = req.params;
  try {
    const memberCheck = await isMember(roomId, req.user.id);
    if (!memberCheck) return res.status(403).json({ error: 'Access denied' });

    const rows = await db.queryAll(
      'SELECT id, user_id as "userId", stroke_data as "strokeData", created_at as "createdAt" FROM whiteboard_strokes WHERE room_id = $1 ORDER BY created_at ASC',
      [roomId]
    );

    const strokes = rows.map((r) => {
      try {
        return { id: r.id, userId: r.userId, ...JSON.parse(r.strokeData) };
      } catch {
        return null;
      }
    }).filter(Boolean);

    res.json({ strokes });
  } catch (err) {
    console.error('Fetch whiteboard failed:', err);
    res.status(500).json({ error: 'Failed to load whiteboard history' });
  }
});

// Clear Whiteboard Canvas
router.delete('/:roomId/whiteboard', async (req, res) => {
  const { roomId } = req.params;
  try {
    const memberCheck = await isMember(roomId, req.user.id);
    if (!memberCheck) return res.status(403).json({ error: 'Access denied' });

    await db.queryRun('DELETE FROM whiteboard_strokes WHERE room_id = $1', [roomId]);
    res.json({ ok: true, message: 'Whiteboard canvas cleared' });
  } catch (err) {
    console.error('Clear whiteboard failed:', err);
    res.status(500).json({ error: 'Failed to clear whiteboard' });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// 🔗 ROOM STATE SERVICE: SHAREABLE GUEST INVITE LINKS (Feature 4)
// ══════════════════════════════════════════════════════════════════════════════

// Generate or Fetch Shareable Invite Link
router.post('/:roomId/invite-link', async (req, res) => {
  const { roomId } = req.params;
  try {
    const memberCheck = await isMember(roomId, req.user.id);
    if (!memberCheck) return res.status(403).json({ error: 'Access denied' });

    let link = await db.queryGet('SELECT token FROM invite_links WHERE room_id = $1', [roomId]);
    if (!link) {
      const token = randomUUID().replace(/-/g, '').slice(0, 16);
      await db.queryRun(
        'INSERT INTO invite_links (id, room_id, token, created_by) VALUES ($1, $2, $3, $4)',
        [randomUUID(), roomId, token, req.user.id]
      );
      link = { token };
    }

    res.json({ ok: true, inviteToken: link.token, joinPath: `/join/${link.token}` });
  } catch (err) {
    console.error('Generate invite link failed:', err);
    res.status(500).json({ error: 'Failed to create invite link' });
  }
});

export default router;


