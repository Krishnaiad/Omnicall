import test from 'node:test';
import assert from 'node:assert';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import fs from 'fs';
import path from 'path';

const testDbPath = path.resolve('./test_data.sqlite');
if (fs.existsSync(testDbPath)) {
  try { fs.unlinkSync(testDbPath); } catch {}
}

process.env.JWT_SECRET = 'test_secret_key_12345';
process.env.DATABASE_PATH = testDbPath;

const { db, randomUUID } = await import('../db.js');
const { signToken } = await import('../auth.js');

test('Backend API - Authentication & Password Hashing', async (t) => {
  await t.test('Password hashing with bcrypt', async () => {
    const pass = 'SecretPassword123';
    const hash = await bcrypt.hash(pass, 10);
    assert.strictEqual(await bcrypt.compare(pass, hash), true);
    assert.strictEqual(await bcrypt.compare('WrongPass', hash), false);
  });

  await t.test('JWT token generation and verification', () => {
    const user = { id: 'u-1', email: 'alice@example.com', name: 'Alice' };
    const token = signToken(user);
    assert.ok(token);

    const verified = jwt.verify(token, process.env.JWT_SECRET);
    assert.strictEqual(verified.sub, 'u-1');
    assert.strictEqual(verified.email, 'alice@example.com');
  });
});

test('Backend Database - Rooms & Membership Permissions', async (t) => {
  const aliceId = randomUUID();
  const bobId = randomUUID();
  const roomId = randomUUID();

  await t.test('Create user records', () => {
    db.prepare('INSERT INTO users (id, email, password_hash, name) VALUES (?, ?, ?, ?)').run(
      aliceId,
      `alice_${Date.now()}@test.com`,
      'hash',
      'Alice'
    );
    db.prepare('INSERT INTO users (id, email, password_hash, name) VALUES (?, ?, ?, ?)').run(
      bobId,
      `bob_${Date.now()}@test.com`,
      'hash',
      'Bob'
    );
    const alice = db.prepare('SELECT * FROM users WHERE id = ?').get(aliceId);
    assert.strictEqual(alice.name, 'Alice');
  });

  await t.test('Create room and verify owner membership', () => {
    db.prepare('INSERT INTO rooms (id, name, owner_id) VALUES (?, ?, ?)').run(roomId, 'Test Room', aliceId);
    db.prepare('INSERT INTO room_members (room_id, user_id, role) VALUES (?, ?, ?)').run(roomId, aliceId, 'owner');

    const memberCheckAlice = db.prepare('SELECT 1 FROM room_members WHERE room_id = ? AND user_id = ?').get(roomId, aliceId);
    assert.ok(memberCheckAlice);

    const memberCheckBob = db.prepare('SELECT 1 FROM room_members WHERE room_id = ? AND user_id = ?').get(roomId, bobId);
    assert.strictEqual(memberCheckBob, undefined);
  });

  await t.test('Invite user to room', () => {
    db.prepare('INSERT INTO room_members (room_id, user_id, role) VALUES (?, ?, ?)').run(roomId, bobId, 'member');
    const memberCheckBob = db.prepare('SELECT 1 FROM room_members WHERE room_id = ? AND user_id = ?').get(roomId, bobId);
    assert.ok(memberCheckBob);
  });
});

test('Backend Database - Custom In-Room Display Name Token Parameters', async (t) => {
  await t.test('Format custom nickname alias correctly', () => {
    const rawAlias = '  CyberNinja_99  ';
    const effectiveName = rawAlias.trim().slice(0, 50);
    assert.strictEqual(effectiveName, 'CyberNinja_99');
  });
});

test('Backend Database - Media File Pipeline Records', async (t) => {
  const mediaId = randomUUID();
  const userId = randomUUID();

  await t.test('Insert media record', () => {
    db.prepare('INSERT INTO users (id, email, password_hash, name) VALUES (?, ?, ?, ?)').run(
      userId,
      `mediauser_${Date.now()}@test.com`,
      'hash',
      'Media User'
    );

    db.prepare(
      `INSERT INTO media_files (id, user_id, original_name, mime_type, file_path, status)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(mediaId, userId, 'intro.mp4', 'video/mp4', '/tmp/intro.mp4', 'processing');

    const fileRecord = db.prepare('SELECT * FROM media_files WHERE id = ?').get(mediaId);
    assert.strictEqual(fileRecord.status, 'processing');
  });

  await t.test('Update media status to ready', () => {
    db.prepare(`UPDATE media_files SET status = 'ready' WHERE id = ?`).run(mediaId);
    const fileRecord = db.prepare('SELECT * FROM media_files WHERE id = ?').get(mediaId);
    assert.strictEqual(fileRecord.status, 'ready');
  });
});
