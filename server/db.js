import 'dotenv/config';
import bcrypt from 'bcryptjs';
import pg from 'pg';
import { randomUUID } from 'node:crypto';

const { Pool } = pg;

export { randomUUID };

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error('[FATAL] DATABASE_URL environment variable is not set. Set it in Render → Environment Variables before starting.');
}

const sslOptions = process.env.PG_SSL_CA
  ? { ca: process.env.PG_SSL_CA, rejectUnauthorized: true }
  : { rejectUnauthorized: false };

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: sslOptions,
  statement_timeout: 15000,
  idle_in_transaction_session_timeout: 30000,
  max: Number(process.env.PG_POOL_MAX || 10),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  keepAlive: true,
});

pool.on('error', (err) => {
  console.error('[DB Pool Error] Unexpected idle client error:', err.message);
});

console.log('[DB] Connecting to PostgreSQL Cloud Database via PgBouncer Pooler...');

// SQL Placeholder Normalizer: supports both native $1 and auto-converts ? if ever passed
function normalizeSql(sql) {
  if (typeof sql === 'string' && sql.includes('?')) {
    let count = 0;
    return sql.replace(/\?/g, () => `$${++count}`);
  }
  return sql;
}

export const db = {
  isPg: () => true,
  exec: async (sql) => {
    return pool.query(sql);
  },
  queryGet: (sql, args = []) => {
    return pool.query(normalizeSql(sql), args).then((res) => res.rows[0]);
  },
  queryRun: (sql, args = []) => {
    return pool.query(normalizeSql(sql), args);
  },
  queryAll: (sql, args = []) => {
    return pool.query(normalizeSql(sql), args).then((res) => res.rows);
  },
};

export async function connectWithBackoff(maxAttempts = 5) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch (err) {
      if (i === maxAttempts - 1) throw err;
      const delay = Math.min(1000 * 2 ** i, 15000);
      console.warn(`[DB] Connect failed, retrying in ${delay}ms:`, err.message);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

// End of wrapper

// Individual CREATE TABLE statements — split for Postgres compatibility
const TABLE_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    name TEXT NOT NULL,
    username TEXT UNIQUE,
    role TEXT DEFAULT 'user',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS rooms (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS room_members (
    room_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    role TEXT DEFAULT 'member',
    joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (room_id, user_id)
  )`,
  `CREATE TABLE IF NOT EXISTS chat_messages (
    id TEXT PRIMARY KEY,
    room_id TEXT NOT NULL,
    sender_id TEXT NOT NULL,
    sender_name TEXT NOT NULL,
    message TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS media_files (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    original_name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    file_path TEXT NOT NULL,
    storage_provider TEXT DEFAULT 'local',
    storage_key TEXT,
    public_url TEXT,
    status TEXT DEFAULT 'ready',
    duration REAL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  // live_sessions: tracks who is ACTIVELY in a call right now (separate from permanent room_members)
  // Used by LiveKit webhook handler to reconcile SFU state with DB — eliminates zombie rows
  `CREATE TABLE IF NOT EXISTS live_sessions (
    id TEXT PRIMARY KEY,
    room_id TEXT NOT NULL,
    room_name TEXT,
    participant_identity TEXT NOT NULL,
    participant_name TEXT,
    joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    left_at TIMESTAMP,
    disconnect_reason TEXT,
    UNIQUE (room_id, participant_identity)
  )`,
  // hand_raises: Monotonic ordered queue for virtual hand raising with host moderation
  `CREATE TABLE IF NOT EXISTS hand_raises (
    id TEXT PRIMARY KEY,
    room_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    user_name TEXT NOT NULL,
    sequence_num INTEGER DEFAULT 1,
    raised_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (room_id, user_id)
  )`,
  // polls: Host-gated interactive polls with server-authoritative status
  `CREATE TABLE IF NOT EXISTS polls (
    id TEXT PRIMARY KEY,
    room_id TEXT NOT NULL,
    creator_id TEXT NOT NULL,
    creator_name TEXT NOT NULL,
    question TEXT NOT NULL,
    options_json TEXT NOT NULL,
    status TEXT DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  // poll_votes: Double-vote prevention via UNIQUE (poll_id, user_id)
  `CREATE TABLE IF NOT EXISTS poll_votes (
    id TEXT PRIMARY KEY,
    poll_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    user_name TEXT,
    option_index INTEGER NOT NULL,
    voted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (poll_id, user_id)
  )`,
  // whiteboard_strokes: Append-only persistent canvas drawing strokes for late-joiner state recovery
  `CREATE TABLE IF NOT EXISTS whiteboard_strokes (
    id TEXT PRIMARY KEY,
    room_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    stroke_data TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  // invite_links: Shareable 1-click guest invite links with token verification
  `CREATE TABLE IF NOT EXISTS invite_links (
    id TEXT PRIMARY KEY,
    room_id TEXT NOT NULL,
    token TEXT UNIQUE NOT NULL,
    created_by TEXT NOT NULL,
    expires_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  // verification_otps: Stores 6-digit email signup OTP codes with 10-minute expiry
  `CREATE TABLE IF NOT EXISTS verification_otps (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    otp_code TEXT NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  // room_memories: Stores personal snapshots and moments captured during calls
  `CREATE TABLE IF NOT EXISTS room_memories (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    room_id TEXT,
    room_name TEXT,
    media_url TEXT NOT NULL,
    thumbnail_url TEXT,
    caption TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
];

// Migration: add column if missing (safe for Postgres)
async function addColumnIfMissing(table, column, type) {
  try {
    await db.exec(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${column} ${type}`);
  } catch (_) {
    // Column already exists — safe to ignore
  }
}

const INDEX_STATEMENTS = [
  'CREATE INDEX IF NOT EXISTS idx_chat_room_created ON chat_messages(room_id, created_at DESC)',
  'CREATE INDEX IF NOT EXISTS idx_room_members_user ON room_members(user_id)',
  'CREATE INDEX IF NOT EXISTS idx_media_user_created ON media_files(user_id, created_at DESC)',
  'CREATE INDEX IF NOT EXISTS idx_memories_user_created ON room_memories(user_id, created_at DESC)',
  'CREATE INDEX IF NOT EXISTS idx_otps_email ON verification_otps(email)',
  'CREATE INDEX IF NOT EXISTS idx_whiteboard_room ON whiteboard_strokes(room_id)',
];

async function initTables() {
  try {
    for (const stmt of TABLE_STATEMENTS) {
      await db.exec(stmt);
    }
    await addColumnIfMissing('users', 'username', 'TEXT');
    await addColumnIfMissing('media_files', 'storage_provider', "TEXT DEFAULT 'local'");
    await addColumnIfMissing('media_files', 'storage_key', 'TEXT');
    await addColumnIfMissing('media_files', 'public_url', 'TEXT');

    for (const idxStmt of INDEX_STATEMENTS) {
      await db.exec(idxStmt).catch(() => {});
    }
  } catch (err) {
    console.warn('[DB] Table initialization notice:', err.message);
  }
}

// Seed Designated Admin Account
export async function seedAdminUser() {
  await connectWithBackoff();
  await initTables();

  const adminEmail = (process.env.ADMIN_EMAIL || 'admin@omnicall.com').toLowerCase().trim();
  const adminName = 'Admin';
  const adminUsername = 'admin';

  if (!process.env.ADMIN_PASSWORD) {
    throw new Error('[FATAL] ADMIN_PASSWORD environment variable is not set. Set it in Render → Environment Variables before starting.');
  }
  const rawPassword = process.env.ADMIN_PASSWORD;


  try {
    const existing = await db.queryGet('SELECT id FROM users WHERE email = $1', [adminEmail]);
    if (!existing) {
      const passwordHash = await bcrypt.hash(rawPassword, 12);
      const adminId = randomUUID();
      await db.queryRun(
        'INSERT INTO users (id, email, password_hash, name, username, role) VALUES ($1, $2, $3, $4, $5, $6)',
        [adminId, adminEmail, passwordHash, adminName, adminUsername, 'admin']
      );
      console.log(`[DB] Designated Admin user initialized: ${adminEmail}`);
    } else {
      await db.queryRun('UPDATE users SET role = $1, username = $2 WHERE email = $3', ['admin', adminUsername, adminEmail]);
    }
  } catch (err) {
    console.error('[DB] Admin seeding notice:', err.message);
  }
}

seedAdminUser();
