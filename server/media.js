import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import ffmpeg from 'fluent-ffmpeg';
import { db, randomUUID } from './db.js';
import { requireAuth } from './auth.js';

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
  // Video
  'video/mp4',
  'video/webm',
  'video/ogg',
  'video/quicktime',
  'video/x-msvideo',
  // Audio
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/ogg',
  'audio/webm',
  'audio/x-m4a',
  // Image / Pictures
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
];

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB max
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file format. Supported formats: MP4, WebM, MP3, WAV, PNG, JPG, WEBP, GIF.'));
    }
  },
});

// Process upload via FFmpeg (or direct copy for images/audio)
function transcodeMedia(fileId, inputPath, outputPath, isImage, isAudio) {
  return new Promise((resolve) => {
    if (isImage) {
      // Direct pass-through for images
      try {
        fs.copyFileSync(inputPath, outputPath);
        fs.unlinkSync(inputPath);
      } catch (err) {
        console.error('Image file copy error:', err);
      }
      return resolve({ success: true, path: outputPath });
    }

    ffmpeg(inputPath)
      .output(outputPath)
      .videoCodec(isAudio ? 'none' : 'libx264')
      .audioCodec('aac')
      .format('mp4')
      .on('end', () => {
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

// Upload endpoint for Images, Video, and Audio
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
    const ext = path.extname(req.file.originalname) || (isImage ? '.png' : '.mp4');
    const processedFilename = `${fileId}${ext}`;
    const outputPath = path.join(processedDir, processedFilename);

    db.prepare(
      `INSERT INTO media_files (id, user_id, original_name, mime_type, file_path, status)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(fileId, req.user.id, req.file.originalname, req.file.mimetype, outputPath, 'processing');

    transcodeMedia(fileId, req.file.path, outputPath, isImage, isAudio).then(() => {
      db.prepare(`UPDATE media_files SET status = 'ready' WHERE id = ?`).run(fileId);
    });

    res.status(202).json({
      message: 'Media uploaded successfully',
      media: {
        id: fileId,
        name: req.file.originalname,
        mimeType: req.file.mimetype,
        status: 'processing',
      },
    });
  });
});

// List user's clips (Images, Videos, Audios)
router.get('/list', (req, res) => {
  const clips = db
    .prepare(
      `SELECT id, original_name as name, mime_type as mimeType, status, duration, created_at
       FROM media_files
       WHERE user_id = ?
       ORDER BY created_at DESC`
    )
    .all(req.user.id);

  res.json({ clips });
});

// Stream authenticated media clip (Images, Video, Audio)
router.get('/stream/:id', (req, res) => {
  const { id } = req.params;
  const clip = db.prepare('SELECT * FROM media_files WHERE id = ?').get(id);

  if (!clip) return res.status(404).json({ error: 'Media file not found' });
  if (clip.user_id !== req.user.id) {
    return res.status(403).json({ error: 'Access denied' });
  }
  if (!fs.existsSync(clip.file_path)) {
    return res.status(404).json({ error: 'Media file does not exist on disk' });
  }

  const stat = fs.statSync(clip.file_path);
  const fileSize = stat.size;
  const mimeType = clip.mime_type || 'application/octet-stream';

  if (mimeType.startsWith('image/')) {
    res.writeHead(200, {
      'Content-Length': fileSize,
      'Content-Type': mimeType,
      'Cache-Control': 'public, max-age=3600',
    });
    return fs.createReadStream(clip.file_path).pipe(res);
  }

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
      'Content-Type': mimeType.startsWith('audio/') ? mimeType : 'video/mp4',
    };
    res.writeHead(206, head);
    file.pipe(res);
  } else {
    const head = {
      'Content-Length': fileSize,
      'Content-Type': mimeType.startsWith('audio/') ? mimeType : 'video/mp4',
    };
    res.writeHead(200, head);
    fs.createReadStream(clip.file_path).pipe(res);
  }
});

// Delete media clip
router.delete('/:id', (req, res) => {
  const { id } = req.params;
  const clip = db.prepare('SELECT * FROM media_files WHERE id = ?').get(id);

  if (!clip) return res.status(404).json({ error: 'Media file not found' });
  if (clip.user_id !== req.user.id) {
    return res.status(403).json({ error: 'Access denied' });
  }

  try {
    if (fs.existsSync(clip.file_path)) fs.unlinkSync(clip.file_path);
  } catch (err) {
    console.warn('Failed to delete physical file:', err);
  }

  db.prepare('DELETE FROM media_files WHERE id = ?').run(id);
  res.json({ ok: true });
});

export default router;
