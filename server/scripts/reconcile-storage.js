import 'dotenv/config';
import { db } from '../db.js';
import { listAllObjects } from '../r2.js';
import { storageConfig } from '../config.js';

async function reconcile() {
  console.log('[Reconcile] Starting DB <-> Storage reconciliation check...');
  if (storageConfig.provider !== 'r2') {
    console.log('[Reconcile] Storage provider is "local". Skipping R2 reconciliation.');
    process.exit(0);
  }

  try {
    const rows = await db.queryAll("SELECT storage_key FROM media_files WHERE storage_provider = 'r2'");
    const dbKeys = new Set(rows.map((r) => r.storage_key).filter(Boolean));
    const r2Keys = await listAllObjects();

    const r2KeySet = new Set(r2Keys);

    const orphanedInR2 = r2Keys.filter((k) => !dbKeys.has(k));
    const missingInR2 = [...dbKeys].filter((k) => !r2KeySet.has(k));

    console.log(`[Reconcile] Total R2 Objects: ${r2Keys.length}`);
    console.log(`[Reconcile] Total DB R2 Records: ${dbKeys.size}`);

    if (orphanedInR2.length > 0) {
      console.warn(`[Reconcile WARNING] Found ${orphanedInR2.length} orphaned R2 objects (in R2 bucket but missing in DB):`, orphanedInR2);
    } else {
      console.log('[Reconcile OK] No orphaned R2 objects found.');
    }

    if (missingInR2.length > 0) {
      console.error(`[Reconcile ERROR] Found ${missingInR2.length} missing R2 objects (in DB but 404 in R2):`, missingInR2);
    } else {
      console.log('[Reconcile OK] All DB records point to valid R2 objects.');
    }

    process.exit(0);
  } catch (err) {
    console.error('[Reconcile Error]:', err.message);
    process.exit(1);
  }
}

reconcile();
