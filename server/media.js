import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import ffmpeg from 'fluent-ffmpeg';
import { db, randomUUID } from './db.js';
import { requireAuth } from './auth.js';
import { storageConfig } from './config.js';
import * as r2 from './r2.js';
import * as cloudinaryHelper from './cloudinary.js';

const router = Router();
router.use(requireAuth);

const uploadsDir = path.resolve(process.env.UPLOADS_DIR || './uploads');
const processedDir = path.resolve(process.env.PROCESSED_DIR || './processed');

if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
if (!fs.existsSync(processedDir)) fs.mkdirSync(processedDir, { recursive: true });

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

function transcodeMedia(fileId, inputPath, outputPath, isImage, isAudio) {
  return new Promise((resolve) => {
    if (isImage) {
      try {
        fs.copyFileSync(inputPath, outputPath);
        fs.unlinkSync(inputPath);
      } catch (err) {
        console.error('Image file copy error:', err);
      }
      return resolve({ success: true, path: outputPath });
    }

    const cmd = ffmpeg(inputPath)
      .output(outputPath)
      .audioCodec('aac')
      .format('mp4');

    if (isAudio) {
      cmd.noVideo();
    } else {
      cmd.videoCodec('libx264');
    }

    cmd.on('end', () => {
        try { fs.unlinkSync(inputPath); } catch {}
        resolve({ success: true, path: outputPath });
      })
      .on('error', (err) => {
        console.warn(`FFmpeg transcoding notice for ${fileId}:`, err.message);
        try {
          fs.copyFileSync(inputPath, outputPath);
          fs.unlinkSync(inputPath);
        } catch (copyErr) {
          console.error('Failed fallback media copy:', copyErr);
        }
        resolve({ success: true, path: outputPath });
      })
      .run();
  });
}

// Upload endpoint for Images, Video, and Audio (Supports Cloudinary, R2 & Local Disk)
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
    const outputPath = path.join(processedDir, processedFilename);
    const storageKey = `media/${processedFilename}`;
    const provider = storageConfig.provider;

    let targetPath = req.file.path;

    try {
      // 1. Process / transcode media file
      await transcodeMedia(fileId, req.file.path, outputPath, isImage, isAudio);
      targetPath = outputPath;

      let publicUrl = null;
      let finalKey = storageKey;
      let duration = 0;

      // 2. Upload to Cloudinary, Cloudflare R2, or Local Disk
      if (provider === 'cloudinary') {
        const cloudRes = await cloudinaryHelper.uploadMedia(outputPath, {
          isVideo,
          isAudio,
          publicId: fileId,
        });
        publicUrl = cloudRes.secureUrl;
        finalKey = cloudRes.publicId;
        duration = cloudRes.duration || 0;
      } else if (provider === 'r2') {
        const fileStream = fs.createReadStream(outputPath);
        const stat = fs.statSync(outputPath);
        await r2.uploadStream(storageKey, fileStream, {
          contentType: req.file.mimetype,
          sizeHint: stat.size,
        });
        publicUrl = process.env.R2_PUBLIC_DOMAIN ? `https://${process.env.R2_PUBLIC_DOMAIN}/${storageKey}` : null;
      } else {
        publicUrl = `/uploads/${processedFilename}`;
      }

      // 3. Single DB Insert into Supabase PostgreSQL
      try {
        await db.queryRun(
          `INSERT INTO media_files (id, user_id, original_name, mime_type, file_path, storage_provider, storage_key, public_url, duration, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [fileId, req.user.id, req.file.originalname, req.file.mimetype, targetPath, provider, finalKey, publicUrl, duration, 'ready']
        );
      } catch (dbErr) {
        // Compensating action: If DB insert fails, delete uploaded file from Cloudinary/R2/local
        console.error('[Storage Compensating Action] DB Insert failed, deleting uploaded file:', dbErr.message);
        if (provider === 'cloudinary') {
          await cloudinaryHelper.deleteMedia(finalKey, { isVideo, isAudio }).catch(() => {});
        } else if (provider === 'r2') {
          await r2.deleteObject(storageKey).catch(() => {});
        }
        try { if (fs.existsSync(targetPath)) fs.unlinkSync(targetPath); } catch {}
        throw dbErr;
      }

      // 4. Clean up local processed file if uploaded to Cloud
      if (provider === 'cloudinary' || provider === 'r2') {
        try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); } catch {}
      }

      res.status(201).json({
        message: 'Media uploaded successfully',
        clip: {
          id: fileId,
          name: req.file.originalname,
          mimeType: req.file.mimetype,
          storageProvider: provider,
          publicUrl,
          status: 'ready',
        },
      });
    } catch (uploadErr) {
      console.error('Save media failed:', uploadErr);
      try { if (fs.existsSync(targetPath)) fs.unlinkSync(targetPath); } catch {}
      res.status(500).json({ error: 'Failed to process media file: ' + uploadErr.message });
    }
  });
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
