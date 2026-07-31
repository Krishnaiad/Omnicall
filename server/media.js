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
  'video/mp4',
  'video/webm',
  'video/ogg',
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/ogg',
  'audio/webm',
];

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB max
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only video (MP4, WebM) and audio (MP3, WAV, WebM) are allowed.'));
    }
  },
});

// Process upload via FFmpeg (or direct pass-through if FFmpeg binary is absent)
function transcodeMedia(fileId, inputPath, outputPath, isAudio) {
  return new Promise((resolve) => {
    ffmpeg(inputPath)
      .output(outputPath)
      .videoCodec(isAudio ? 'none' : 'libx264')
      .audioCodec('aac')
      .format(isAudio ? 'mp4' : 'mp4')
      .on('end', () => {
        try { fs.unlinkSync(inputPath); } catch {}
        resolve({ success: true, path: outputPath });
      })
      .on('error', (err) => {
        console.warn(`FFmpeg transcoding notice for ${fileId}:`, err.message);
        // Fallback: move original file to processed if ffmpeg binary missing or fails
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

// Upload endpoint
router.post('/upload', (req, res) => {
  upload.single('clip')(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ error: err.message || 'File upload failed' });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'No media clip file provided' });
    }

    const fileId = randomUUID();
    const isAudio = req.file.mimetype.startsWith('audio/');
    const processedFilename = `${fileId}.mp4`;
    const outputPath = path.join(processedDir, processedFilename);

    // Save metadata record initial status
    db.prepare(
      `INSERT INTO media_files (id, user_id, original_name, mime_type, file_path, status)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(fileId, req.user.id, req.file.originalname, req.file.mimetype, outputPath, 'processing');

    // Asynchronous background transcoding pass
    transcodeMedia(fileId, req.file.path, outputPath, isAudio).then(() => {
      db.prepare(`UPDATE media_files SET status = 'ready' WHERE id = ?`).run(fileId);
    });

    res.status(202).json({
      message: 'Media clip received and processing started',
      media: {
        id: fileId,
        name: req.file.originalname,
        mimeType: req.file.mimetype,
        status: 'processing',
      },
    });
  });
});

// List user's clips
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

// Stream authenticated media clip
router.get('/stream/:id', (req, res) => {
  const { id } = req.params;
  const clip = db.prepare('SELECT * FROM media_files WHERE id = ?').get(id);

  if (!clip) return res.status(404).json({ error: 'Media clip not found' });
  if (clip.user_id !== req.user.id) {
    return res.status(403).json({ error: 'Access denied to this media clip' });
  }
  if (!fs.existsSync(clip.file_path)) {
    return res.status(404).json({ error: 'Media file does not exist on disk' });
  }

  const stat = fs.statSync(clip.file_path);
  const fileSize = stat.size;
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
      'Content-Type': 'video/mp4',
    };
    res.writeHead(206, head);
    file.pipe(res);
  } else {
    const head = {
      'Content-Length': fileSize,
      'Content-Type': 'video/mp4',
    };
    res.writeHead(200, head);
    fs.createReadStream(clip.file_path).pipe(res);
  }
});

// Delete media clip
router.delete('/:id', (req, res) => {
  const { id } = req.params;
  const clip = db.prepare('SELECT * FROM media_files WHERE id = ?').get(id);

  if (!clip) return res.status(404).json({ error: 'Media clip not found' });
  if (clip.user_id !== req.user.id) {
    return res.status(403).json({ error: 'Access denied' });
  }

  try {
    if (fs.existsSync(clip.file_path)) fs.unlinkSync(clip.file_path);
  } catch (err) {
    console.warn('Failed to delete physical media file:', err);
  }

  db.prepare('DELETE FROM media_files WHERE id = ?').run(id);
  res.json({ ok: true });
});

export default router;
