import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { db, randomUUID } from './db.js';
import { requireAuth } from './auth.js';
import { storageConfig } from './config.js';
import * as r2 from './r2.js';
import * as cloudinaryHelper from './cloudinary.js';

const router = Router();
router.use(requireAuth);

const uploadsDir = path.resolve(process.env.UPLOADS_DIR || './uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${randomUUID()}${ext}`);
  },
});

const ALLOWED_MIME_TYPES = [
  'video/mp4',
  'video/webm',
  'video/ogg',
  'video/quicktime',
  'video/x-msvideo',
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/ogg',
  'audio/webm',
  'audio/x-m4a',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
];

const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB max
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME_TYPES.includes(file.mimetype.toLowerCase())) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file format. Supported formats: MP4, WebM, MP3, WAV, PNG, JPG, WEBP, GIF.'));
    }
  },
});

// Upload endpoint for Images, Video, and Audio (Direct Fast Cloudinary / Storage Streaming)
router.post('/upload', (req, res) => {
  upload.single('clip')(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ error: err.message || 'File upload failed' });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'No media file provided' });
    }

    const fileId = randomUUID();
    const isImage = req.file.mimetype.startsWith('image/');
    const isAudio = req.file.mimetype.startsWith('audio/');
    const isVideo = req.file.mimetype.startsWith('video/');
    const ext = path.extname(req.file.originalname) || (isImage ? '.png' : '.mp4');
    const processedFilename = `${fileId}${ext}`;
    const storageKey = `media/${processedFilename}`;
    const provider = storageConfig.provider;
    const tempPath = req.file.path;

    try {
      let publicUrl = null;
      let finalKey = storageKey;
      let duration = 0;

      // Direct upload to Cloudinary (zero CPU / zero local RAM)
      if (provider === 'cloudinary') {
        const cloudRes = await cloudinaryHelper.uploadMedia(tempPath, {
          isVideo,
          isAudio,
          publicId: fileId,
        });
        publicUrl = cloudRes.secureUrl;
        finalKey = cloudRes.publicId;
        duration = cloudRes.duration || 0;
        
        // Immediately clean up temp file from disk
        try { fs.unlinkSync(tempPath); } catch {}
      } else if (provider === 'r2') {
        const fileStream = fs.createReadStream(tempPath);
        const stat = fs.statSync(tempPath);
        await r2.uploadStream(storageKey, fileStream, {
          contentType: req.file.mimetype,
          sizeHint: stat.size,
        });
        publicUrl = process.env.R2_PUBLIC_DOMAIN ? `https://${process.env.R2_PUBLIC_DOMAIN}/${storageKey}` : null;
        try { fs.unlinkSync(tempPath); } catch {}
      } else {
        publicUrl = `/uploads/${path.basename(tempPath)}`;
      }

      // Single DB Insert into Supabase PostgreSQL
      await db.queryRun(
        `INSERT INTO media_files (id, user_id, original_name, mime_type, file_path, storage_provider, storage_key, public_url, duration, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [fileId, req.user.id, req.file.originalname, req.file.mimetype, tempPath, provider, finalKey, publicUrl, duration, 'ready']
      );

      res.status(201).json({
        ok: true,
        file: {
          id: fileId,
          originalName: req.file.originalname,
          mimeType: req.file.mimetype,
          storageProvider: provider,
          publicUrl,
          duration,
          status: 'ready',
          createdAt: new Date().toISOString(),
        },
      });
    } catch (uploadErr) {
      console.error('Media upload failed:', uploadErr);
      try { fs.unlinkSync(tempPath); } catch {}
      res.status(500).json({ error: 'Media processing failed: ' + uploadErr.message });
    }
  });
});

// Delete all user's uploaded clips (Bulk cleanup)
router.delete('/all', async (req, res) => {
  try {
    const clips = await db.queryAll('SELECT id, storage_provider, storage_key, mime_type FROM media_files WHERE user_id = ?', [req.user.id]);
    for (const clip of clips) {
      if (clip.storage_provider === 'cloudinary' && clip.storage_key) {
        const isVideo = clip.mime_type?.startsWith('video/') || clip.mime_type?.startsWith('audio/');
        await cloudinaryHelper.deleteMedia(clip.storage_key, { isVideo }).catch(() => {});
      }
    }
    await db.queryRun('DELETE FROM media_files WHERE user_id = ?', [req.user.id]);
    res.json({ ok: true, message: 'All uploaded media deleted successfully' });
  } catch (err) {
    console.error('Delete all clips failed:', err);
    res.status(500).json({ error: 'Failed to delete media clips' });
  }
});


// List user's uploaded clips with storage provider badge
router.get('/list', async (req, res) => {
  try {
    const clips = await db.queryAll(
      `SELECT id, original_name as name, mime_type as "mimeType", storage_provider as "storageProvider", public_url as "publicUrl", status, duration, created_at
       FROM media_files
       WHERE user_id = ?
       ORDER BY created_at DESC`,
      [req.user.id]
    );

    res.json({ clips });
  } catch (err) {
    console.error('List media files failed:', err);
    res.status(500).json({ error: 'Failed to list media files' });
  }
});

// Stream or play media clip — 302 Redirect for Cloudinary / R2, streaming for local disk
router.get('/stream/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const clip = await db.queryGet('SELECT * FROM media_files WHERE id = ?', [id]);
    if (!clip) {
      return res.status(404).json({ error: 'Media file not found' });
    }

    // Cloudinary Direct CDN Streaming (302 Redirect to Akamai/CloudFront CDN URL — 0 Express bandwidth!)
    if (clip.storage_provider === 'cloudinary' && clip.public_url) {
      return res.redirect(302, clip.public_url);
    }

    // Cloudflare R2 Direct Playback (302 Redirect to presigned URL)
    if (clip.storage_provider === 'r2' && clip.storage_key) {
      try {
        const presignedUrl = await r2.getPresignedGetUrl(clip.storage_key, 600);
        return res.redirect(302, presignedUrl);
      } catch (r2Err) {
        console.error('Failed to generate presigned GET URL for R2:', r2Err);
        return res.status(500).json({ error: 'Failed to access Cloudflare R2 storage' });
      }
    }

    // Local Disk Storage Playback
    if (!fs.existsSync(clip.file_path)) {
      return res.status(404).json({ error: 'Media file missing on server' });
    }

    const stat = fs.statSync(clip.file_path);
    const fileSize = stat.size;
    const mimeType = clip.mime_type || 'application/octet-stream';

    const range = req.headers.range;
    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunksize = end - start + 1;
      const file = fs.createReadStream(clip.file_path, { start, end });
      const head = {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunksize,
        'Content-Type': mimeType,
      };
      res.writeHead(206, head);
      file.pipe(res);
    } else {
      const head = {
        'Content-Length': fileSize,
        'Content-Type': mimeType,
      };
      res.writeHead(200, head);
      fs.createReadStream(clip.file_path).pipe(res);
    }
  } catch (err) {
    console.error('Stream media failed:', err);
    res.status(500).json({ error: 'Failed to stream media' });
  }
});

// Delete media clip
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const clip = await db.queryGet('SELECT * FROM media_files WHERE id = ?', [id]);

    if (!clip) return res.status(404).json({ error: 'Media file not found' });
    if (clip.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const isAudio = clip.mime_type?.startsWith('audio/');
    const isVideo = clip.mime_type?.startsWith('video/');

    if (clip.storage_provider === 'cloudinary' && clip.storage_key) {
      await cloudinaryHelper.deleteMedia(clip.storage_key, { isVideo, isAudio }).catch((err) => {
        console.warn('Failed to delete media from Cloudinary:', err.message);
      });
    } else if (clip.storage_provider === 'r2' && clip.storage_key) {
      await r2.deleteObject(clip.storage_key).catch((err) => {
        console.warn('Failed to delete object from R2:', err.message);
      });
    } else {
      try {
        if (fs.existsSync(clip.file_path)) fs.unlinkSync(clip.file_path);
      } catch (err) {
        console.warn('Failed to delete physical file:', err);
      }
    }

    await db.queryRun('DELETE FROM media_files WHERE id = ?', [id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('Delete media failed:', err);
    res.status(500).json({ error: 'Failed to delete media clip' });
  }
});

export default router;
