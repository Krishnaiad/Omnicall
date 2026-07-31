import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { db, randomUUID } from './db.js';

const router = Router();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'admin@omnicall.com').toLowerCase().trim();

function getSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is not configured');
  return secret;
}

export function signToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email, name: user.name, role: user.role || 'user' },
    getSecret(),
    { expiresIn: '7d' }
  );
}

router.post('/register', async (req, res) => {
  try {
    const { email, password, name } = req.body || {};
    if (!email || !password || !name) {
      return res.status(400).json({ error: 'Email, password, and name are required' });
    }
    if (!EMAIL_RE.test(email)) {
      return res.status(400).json({ error: 'Invalid email address' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters long' });
    }
    if (!name.trim() || name.length > 50) {
      return res.status(400).json({ error: 'Name must be between 1 and 50 characters' });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const existing = await db.queryGet('SELECT id FROM users WHERE email = ?', [normalizedEmail]);
    if (existing) {
      return res.status(409).json({ error: 'An account with this email already exists' });
    }

    const assignedRole = normalizedEmail === ADMIN_EMAIL ? 'admin' : 'user';

    const passwordHash = await bcrypt.hash(password, 12);
    const id = randomUUID();
    await db.queryRun(
      'INSERT INTO users (id, email, password_hash, name, role) VALUES (?, ?, ?, ?, ?)',
      [id, normalizedEmail, passwordHash, name.trim(), assignedRole]
    );

    const user = { id, email: normalizedEmail, name: name.trim(), role: assignedRole };
    res.status(201).json({ token: signToken(user), user });
  } catch (err) {
    console.error('Register failed:', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const row = await db.queryGet('SELECT * FROM users WHERE email = ?', [normalizedEmail]);
    const valid = row ? await bcrypt.compare(password, row.password_hash) : false;

    if (!row || !valid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const user = { id: row.id, email: row.email, name: row.name, role: row.role || 'user' };
    res.json({ token: signToken(user), user });
  } catch (err) {
    console.error('Login failed:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'Missing access token' });
  }

  try {
    const payload = jwt.verify(token, getSecret());
    req.user = { id: payload.sub, email: payload.email, name: payload.name, role: payload.role || 'user' };
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

export function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Access denied: Admin privileges required' });
  }
  next();
}

// Protected Admin Directory Endpoint
router.get('/users', requireAuth, requireAdmin, async (req, res) => {
  try {
    const users = await db.queryAll('SELECT id, name, email, role, created_at FROM users ORDER BY created_at DESC');
    res.json({ users });
  } catch (err) {
    console.error('List users failed:', err);
    res.status(500).json({ error: 'Failed to fetch user directory' });
  }
});

export default router;
