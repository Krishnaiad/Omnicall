import { Router } from 'express';
import { db, randomUUID } from './db.js';
import { requireAuth } from './auth.js';

const router = Router();
router.use(requireAuth);

// List user's personal saved call memories & snapshots
router.get('/', async (req, res) => {
  try {
    const rows = await db.queryAll(
      `SELECT id, room_id as "roomId", room_name as "roomName", media_url as "mediaUrl", thumbnail_url as "thumbnailUrl", caption, created_at as "createdAt"
       FROM room_memories
       WHERE user_id = ?
       ORDER BY created_at DESC`,
      [req.user.id]
    );
    res.json({ memories: rows });
  } catch (err) {
    console.error('Fetch memories failed:', err);
    res.status(500).json({ error: 'Failed to load room memories' });
  }
});

// Save snapshot/moment to user's personal memories gallery
router.post('/', async (req, res) => {
  const { roomId, roomName, mediaUrl, thumbnailUrl, caption } = req.body || {};

  if (!mediaUrl) {
    return res.status(400).json({ error: 'Media URL is required' });
  }

  // Validate that mediaUrl and thumbnailUrl are real https:// URLs, not javascript: or data: XSS vectors
  const isValidUrl = (url) => {
    if (!url) return true; // optional fields are fine to omit
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'https:' || parsed.protocol === 'http:';
    } catch {
      return false;
    }
  };

  if (!isValidUrl(mediaUrl)) {
    return res.status(400).json({ error: 'mediaUrl must be a valid HTTP/HTTPS URL' });
  }
  if (!isValidUrl(thumbnailUrl)) {
    return res.status(400).json({ error: 'thumbnailUrl must be a valid HTTP/HTTPS URL' });
  }

  try {
    const memoryId = randomUUID();

    await db.queryRun(
      `INSERT INTO room_memories (id, user_id, room_id, room_name, media_url, thumbnail_url, caption)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [memoryId, req.user.id, roomId || null, roomName || 'OmniCall Room', mediaUrl, thumbnailUrl || null, caption || 'Call Snapshot']
    );

    res.status(201).json({
      ok: true,
      memory: {
        id: memoryId,
        userId: req.user.id,
        roomId,
        roomName: roomName || 'OmniCall Room',
        mediaUrl,
        thumbnailUrl: thumbnailUrl || null,
        caption: caption || 'Call Snapshot',
        createdAt: new Date().toISOString(),
      },
    });
  } catch (err) {
    console.error('Save memory failed:', err);
    res.status(500).json({ error: 'Failed to save snapshot to memories' });
  }
});

// Delete memory snapshot
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await db.queryRun('DELETE FROM room_memories WHERE id = ? AND user_id = ?', [id, req.user.id]);
    res.json({ ok: true, message: 'Memory deleted' });
  } catch (err) {
    console.error('Delete memory failed:', err);
    res.status(500).json({ error: 'Failed to delete memory' });
  }
});

export default router;
