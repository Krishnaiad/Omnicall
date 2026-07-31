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

const DATABASE_URL = process.env.DATABASE_URL;
let isPg = false;
let pool = null;
let sqliteDb = null;

if (DATABASE_URL) {
  isPg = true;
  pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  console.log('[DB] Connecting to PostgreSQL Cloud Database...');
} else {
  const dbPath = path.resolve(process.env.DATABASE_PATH || './data.sqlite');
  const dbDir = path.dirname(dbPath);
  if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });
  sqliteDb = new DatabaseSync(dbPath);
  console.log('[DB] Running on Local SQLite Database...');
}

// Universal DB Interface Wrapper
export const db = {
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

// Initialize Tables
async function initTables() {
  const createTablesSql = `
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT DEFAULT 'user',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS rooms (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS room_members (
      room_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT DEFAULT 'member',
      joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (room_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL,
      sender_id TEXT NOT NULL,
      sender_name TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS media_files (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      original_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      file_path TEXT NOT NULL,
      status TEXT DEFAULT 'ready',
      duration REAL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `;

  try {
    await db.exec(createTablesSql);
  } catch (err) {
    console.warn('[DB] Table initialization notice:', err.message);
  }
}

// Seed Designated Admin Account
export async function seedAdminUser() {
  await initTables();

  const adminEmail = (process.env.ADMIN_EMAIL || 'admin@omnicall.com').toLowerCase().trim();
  const adminName = 'Admin';
  const rawPassword = process.env.ADMIN_PASSWORD || 'adminomnicall@12';

  try {
    const existing = await db.queryGet('SELECT id FROM users WHERE email = ?', [adminEmail]);
    if (!existing) {
      const passwordHash = await bcrypt.hash(rawPassword, 12);
      const adminId = randomUUID();
      await db.queryRun(
        'INSERT INTO users (id, email, password_hash, name, role) VALUES (?, ?, ?, ?, ?)',
        [adminId, adminEmail, passwordHash, adminName, 'admin']
      );
      console.log(`[DB] Designated Admin user initialized: ${adminEmail}`);
    } else {
      await db.queryRun('UPDATE users SET role = ? WHERE email = ?', ['admin', adminEmail]);
    }
  } catch (err) {
    console.error('[DB] Admin seeding notice:', err.message);
  }
}

seedAdminUser();
