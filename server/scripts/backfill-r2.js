import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { db } from '../db.js';
import { uploadStream } from '../r2.js';
import { storageConfig } from '../config.js';

async function backfill() {
  console.log('[Backfill] Starting Local -> R2 media migration pass...');
  if (storageConfig.provider !== 'r2') {
    console.error('[Backfill Error] R2 is not configured in .env. Please set R2 credentials first.');
    process.exit(1);
  }

  try {
    const localClips = await db.queryAll("SELECT * FROM media_files WHERE storage_provider = 'local' OR storage_provider IS NULL");
    console.log(`[Backfill] Found ${localClips.length} local media files to migrate to R2.`);

    let migrated = 0;
    for (const clip of localClips) {
      if (!fs.existsSync(clip.file_path)) {
        console.warn(`[Backfill Skip] File missing on local disk: ${clip.file_path}`);
        continue;
      }

      const filename = path.basename(clip.file_path);
      const storageKey = clip.storage_key || `media/${filename}`;
      const stat = fs.statSync(clip.file_path);

      console.log(`[Backfill] Uploading ${clip.original_name} (${stat.size} bytes) -> R2 key: ${storageKey}...`);
      const fileStream = fs.createReadStream(clip.file_path);

      await uploadStream(storageKey, fileStream, {
        contentType: clip.mime_type,
        sizeHint: stat.size,
      });

      const publicUrl = process.env.R2_PUBLIC_DOMAIN ? `https://${process.env.R2_PUBLIC_DOMAIN}/${storageKey}` : null;

      // Update DB record to R2
      await db.queryRun(
        "UPDATE media_files SET storage_provider = 'r2', storage_key = ?, public_url = ? WHERE id = ?",
        [storageKey, publicUrl, clip.id]
      );

      // Safe cleanup of local file only after DB confirmation
      try {
        fs.unlinkSync(clip.file_path);
      } catch (err) {
        console.warn(`[Backfill] Local cleanup notice for ${clip.id}:`, err.message);
      }

      migrated++;
    }

    console.log(`[Backfill Complete] Successfully migrated ${migrated}/${localClips.length} files to Cloudflare R2!`);
    process.exit(0);
  } catch (err) {
    console.error('[Backfill Error]:', err.message);
    process.exit(1);
  }
}

backfill();
