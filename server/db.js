import 'dotenv/config';
import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import fs from 'fs';
import bcrypt from 'bcryptjs';
import pg from 'pg';

const { Pool } = pg;

export function randomUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres.uwruxjmzwroxcvctsqyg:Joshiji%4012iisc@aws-0-ap-south-1.pooler.supabase.com:5432/postgres';
let isPg = false;
let pool = null;
let sqliteDb = null;


if (DATABASE_URL) {
  isPg = true;
  const sslOptions = process.env.PG_SSL_CA
    ? { ca: process.env.PG_SSL_CA, rejectUnauthorized: true }
    : { rejectUnauthorized: false };

  pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: sslOptions,
    statement_timeout: 15000,
    idle_in_transaction_session_timeout: 30000,
    max: Number(process.env.PG_POOL_MAX || 10),
  });

  pool.on('error', (err) => {
    console.error('[DB Pool Error] Unexpected idle client error:', err.message);
  });

  console.log('[DB] Connecting to PostgreSQL Cloud Database...');
} else {
  const dbPath = path.resolve(process.env.DATABASE_PATH || './data.sqlite');
  const dbDir = path.dirname(dbPath);
  if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });
  sqliteDb = new DatabaseSync(dbPath);
  console.log('[DB] Running on Local SQLite Database...');
}

export async function connectWithBackoff(maxAttempts = 5) {
  if (!isPg || !pool) return;
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

export const db = {
  isPg: () => isPg,
  exec: async (sql) => {
    if (isPg) {
      return pool.query(sql);
    } else {
      return sqliteDb.exec(sql);
    }
  },
  prepare: (sql) => {
    return {
      run: (...args) => {
        if (isPg) {
          let count = 0;
          const pgSql = sql.replace(/\?/g, () => `$${++count}`);
          return pool.query(pgSql, args);
        } else {
          return sqliteDb.prepare(sql).run(...args);
        }
      },
      get: (...args) => {
        if (isPg) {
          let count = 0;
          const pgSql = sql.replace(/\?/g, () => `$${++count}`);
          return pool.query(pgSql, args).then((res) => res.rows[0]);
        } else {
          return sqliteDb.prepare(sql).get(...args);
        }
      },
      all: (...args) => {
        if (isPg) {
          let count = 0;
          const pgSql = sql.replace(/\?/g, () => `$${++count}`);
          return pool.query(pgSql, args).then((res) => res.rows);
        } else {
          return sqliteDb.prepare(sql).all(...args);
        }
      },
    };
  },
  queryGet: (sql, args = []) => {
    if (isPg) {
      let count = 0;
      const pgSql = sql.replace(/\?/g, () => `$${++count}`);
      return pool.query(pgSql, args).then((res) => res.rows[0]);
    } else {
      return Promise.resolve(sqliteDb.prepare(sql).get(...args));
    }
  },
  queryAll: (sql, args = []) => {
    if (isPg) {
      let count = 0;
      const pgSql = sql.replace(/\?/g, () => `$${++count}`);
      return pool.query(pgSql, args).then((res) => res.rows);
    } else {
      return Promise.resolve(sqliteDb.prepare(sql).all(...args));
    }
  },
  queryRun: (sql, args = []) => {
    if (isPg) {
      let count = 0;
      const pgSql = sql.replace(/\?/g, () => `$${++count}`);
      return pool.query(pgSql, args);
    } else {
      return Promise.resolve(sqliteDb.prepare(sql).run(...args));
    }
  },
};

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

// Migration: add column if missing (safe for both SQLite and Postgres)
async function addColumnIfMissing(table, column, type) {
  try {
    if (isPg) {
      await db.exec(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${column} ${type}`);
    } else {
      // SQLite: attempt ALTER and swallow "duplicate column" error
      await db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
    }
  } catch (_) {
    // Column already exists — safe to ignore
  }
}

async function initTables() {
  try {
    for (const stmt of TABLE_STATEMENTS) {
      await db.exec(stmt);
    }
    await addColumnIfMissing('users', 'username', 'TEXT');
    await addColumnIfMissing('media_files', 'storage_provider', "TEXT DEFAULT 'local'");
    await addColumnIfMissing('media_files', 'storage_key', 'TEXT');
    await addColumnIfMissing('media_files', 'public_url', 'TEXT');
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
  const rawPassword = process.env.ADMIN_PASSWORD || 'adminomnicall@12';

  try {
    const existing = await db.queryGet('SELECT id FROM users WHERE email = ?', [adminEmail]);
    if (!existing) {
      const passwordHash = await bcrypt.hash(rawPassword, 12);
      const adminId = randomUUID();
      await db.queryRun(
        'INSERT INTO users (id, email, password_hash, name, username, role) VALUES (?, ?, ?, ?, ?, ?)',
        [adminId, adminEmail, passwordHash, adminName, adminUsername, 'admin']
      );
      console.log(`[DB] Designated Admin user initialized: ${adminEmail}`);
    } else {
      await db.queryRun('UPDATE users SET role = ?, username = ? WHERE email = ?', ['admin', adminUsername, adminEmail]);
    }
  } catch (err) {
    console.error('[DB] Admin seeding notice:', err.message);
  }
}

seedAdminUser();
