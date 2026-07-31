import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import fs from 'fs';
import bcrypt from 'bcryptjs';

const dbPath = path.resolve(process.env.DATABASE_PATH || './data.sqlite');
const dbDir = path.dirname(dbPath);

if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

export const db = new DatabaseSync(dbPath);

// Initialize database schema
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT DEFAULT 'user',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS rooms (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (owner_id) REFERENCES users (id)
  );

  CREATE TABLE IF NOT EXISTS room_members (
    room_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    role TEXT DEFAULT 'member',
    joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (room_id, user_id),
    FOREIGN KEY (room_id) REFERENCES rooms (id),
    FOREIGN KEY (user_id) REFERENCES users (id)
  );

  CREATE TABLE IF NOT EXISTS media_files (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    original_name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    file_path TEXT NOT NULL,
    status TEXT DEFAULT 'ready',
    duration REAL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users (id)
  );
`);

// Migration check for role column if table previously existed
try {
  db.exec(`ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'user';`);
} catch {
  // column already exists
}

export function randomUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// Seed Designated Admin Account
export async function seedAdminUser() {
  const adminEmail = (process.env.ADMIN_EMAIL || 'admin@omnicall.com').toLowerCase().trim();
  const adminName = 'Admin';
  const rawPassword = process.env.ADMIN_PASSWORD || 'adminomnicall@12';

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(adminEmail);
  if (!existing) {
    const passwordHash = await bcrypt.hash(rawPassword, 12);
    const adminId = randomUUID();
    db.prepare('INSERT INTO users (id, email, password_hash, name, role) VALUES (?, ?, ?, ?, ?)').run(
      adminId,
      adminEmail,
      passwordHash,
      adminName,
      'admin'
    );
    console.log(`[DB] Designated Admin user initialized: ${adminEmail}`);
  } else {
    // Ensure existing admin account has admin role
    db.prepare('UPDATE users SET role = ? WHERE email = ?').run('admin', adminEmail);
  }
}

seedAdminUser();
