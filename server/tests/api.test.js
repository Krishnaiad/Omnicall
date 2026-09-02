import test from 'node:test';
import assert from 'node:assert';
import request from 'supertest';
import { db, randomUUID } from '../db.js';
import { signToken } from '../auth.js';
import app from '../index.js';

test('Backend API - Authorization tests', async (t) => {
  // Ensure we are using a test database or at least Postgres is available
  if (!process.env.DATABASE_URL) {
    throw new Error('[FATAL] DATABASE_URL environment variable is not set.');
  }

  const adminUser = { id: randomUUID(), email: 'admin@omnicall.com', name: 'Admin', role: 'admin' };
  const normalUser = { id: randomUUID(), email: 'user@omnicall.com', name: 'User', role: 'user' };
  const adminToken = signToken(adminUser);
  const userToken = signToken(normalUser);

  // We need users in the DB to satisfy foreign keys
  await db.queryRun('INSERT INTO users (id, email, password_hash, name, role) VALUES ($1, $2, $3, $4, $5)', [adminUser.id, adminUser.email, 'hash', adminUser.name, adminUser.role]);
  await db.queryRun('INSERT INTO users (id, email, password_hash, name, role) VALUES ($1, $2, $3, $4, $5)', [normalUser.id, normalUser.email, 'hash', normalUser.name, normalUser.role]);

  await t.test('requireAuth failure states', async () => {
    // No token
    let res = await request(app).get('/api/users');
    assert.strictEqual(res.statusCode, 401);

    // Invalid token
    res = await request(app).get('/api/users').set('Authorization', 'Bearer invalidtoken123');
    assert.strictEqual(res.statusCode, 401);
  });

  await t.test('DELETE /api/auth/users/:userId (admin vs non-admin)', async () => {
    // Non-admin trying to delete a user
    let res = await request(app)
      .delete(`/api/auth/users/${normalUser.id}`)
      .set('Authorization', `Bearer ${userToken}`);
    assert.strictEqual(res.statusCode, 403);

    // Admin trying to delete a user (success or 400 if self)
    res = await request(app)
      .delete(`/api/auth/users/${normalUser.id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    assert.strictEqual(res.statusCode, 200);
  });

  await t.test('GET /api/media/stream/:id', async () => {
    const res = await request(app).get('/api/media/stream/some-invalid-id').set('Authorization', `Bearer ${userToken}`);
    // Should be 404 or 403 because we don't own it
    assert.ok(res.statusCode === 404 || res.statusCode === 403);
  });

  await t.test('GET /api/rooms/:roomId/messages', async () => {
    const res = await request(app).get('/api/rooms/invalid-room/messages').set('Authorization', `Bearer ${userToken}`);
    assert.ok(res.statusCode === 404 || res.statusCode === 403);
  });

  t.after(async () => {
    // Clean up
    await db.queryRun('DELETE FROM users WHERE id = $1', [adminUser.id]).catch(() => {});
    await db.queryRun('DELETE FROM users WHERE id = $1', [normalUser.id]).catch(() => {});
  });
});
