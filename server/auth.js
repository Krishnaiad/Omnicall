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

// 15-minute Short-Lived Access Token (Enterprise Grade Security)
export function signAccessToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email, name: user.name, username: user.username, role: user.role || 'user', type: 'access' },
    getSecret(),
    { expiresIn: '15m' }
  );
}

// 7-day Refresh Token (Silent Background Session Renewal)
export function signRefreshToken(user) {
  return jwt.sign(
    { sub: user.id, type: 'refresh' },
    getSecret(),
    { expiresIn: '7d' }
  );
}

// Backwards-compatible alias
export const signToken = signAccessToken;


router.post('/register', async (req, res) => {
  try {
    const { email, password, name, username } = req.body || {};
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

    let assignedUsername = (username && username.trim()) ? username.trim().toLowerCase() : normalizedEmail.split('@')[0];
    const usernameTaken = await db.queryGet('SELECT id FROM users WHERE LOWER(username) = ?', [assignedUsername]);
    if (usernameTaken) {
      assignedUsername = `${assignedUsername}_${Math.floor(1000 + Math.random() * 9000)}`;
    }

    const assignedRole = normalizedEmail === ADMIN_EMAIL ? 'admin' : 'user';

    const passwordHash = await bcrypt.hash(password, 12);
    const id = randomUUID();
    await db.queryRun(
      'INSERT INTO users (id, email, password_hash, name, username, role) VALUES (?, ?, ?, ?, ?, ?)',
      [id, normalizedEmail, passwordHash, name.trim(), assignedUsername, assignedRole]
    );

    const user = { id, email: normalizedEmail, name: name.trim(), username: assignedUsername, role: assignedRole };
    const accessToken = signAccessToken(user);
    const refreshToken = signRefreshToken(user);
    res.status(201).json({ token: accessToken, refreshToken, user });
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

    const user = { id: row.id, email: row.email, name: row.name, username: row.username, role: row.role || 'user' };
    const accessToken = signAccessToken(user);
    const refreshToken = signRefreshToken(user);
    res.json({ token: accessToken, refreshToken, user });
  } catch (err) {
    console.error('Login failed:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Silent Background Token Renewal Endpoint
router.post('/refresh', async (req, res) => {
  const { refreshToken } = req.body || {};
  if (!refreshToken) {
    return res.status(400).json({ error: 'Refresh token is required' });
  }

  try {
    const payload = jwt.verify(refreshToken, getSecret());
    if (payload.type !== 'refresh' || !payload.sub) {
      return res.status(401).json({ error: 'Invalid refresh token' });
    }

    const userRow = await db.queryGet('SELECT id, email, name, username, role FROM users WHERE id = ?', [payload.sub]);
    if (!userRow) {
      return res.status(401).json({ error: 'User account not found' });
    }

    const user = {
      id: userRow.id,
      email: userRow.email,
      name: userRow.name,
      username: userRow.username,
      role: userRow.role || 'user',
    };

    const newAccessToken = signAccessToken(user);
    const newRefreshToken = signRefreshToken(user);

    res.json({ token: newAccessToken, refreshToken: newRefreshToken, user });
  } catch {
    return res.status(401).json({ error: 'Expired or invalid refresh token' });
  }
});


export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : (req.query?.token || null);
  if (!token) {
    return res.status(401).json({ error: 'Missing access token' });
  }

  try {
    const payload = jwt.verify(token, getSecret());
    req.user = { id: payload.sub, email: payload.email, name: payload.name, username: payload.username, role: payload.role || 'user' };
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

// Profile update endpoint — with unique username enforcement
router.put('/profile', requireAuth, async (req, res) => {
  const { name, username } = req.body || {};
  if (!name || !name.trim() || !username || !username.trim()) {
    return res.status(400).json({ error: 'Name and Username are required' });
  }

  const cleanName = name.trim().slice(0, 50);
  const cleanUsername = username.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');

  if (cleanUsername.length < 3) {
    return res.status(400).json({ error: 'Username must be at least 3 alphanumeric characters long' });
  }

  try {
    const existing = await db.queryGet(
      'SELECT id FROM users WHERE LOWER(username) = ? AND id != ?',
      [cleanUsername, req.user.id]
    );

    if (existing) {
      return res.status(409).json({ error: `Username "@${cleanUsername}" is already taken. Please choose another username.` });
    }

    await db.queryRun(
      'UPDATE users SET name = ?, username = ? WHERE id = ?',
      [cleanName, cleanUsername, req.user.id]
    );

    const updatedUser = {
      id: req.user.id,
      email: req.user.email,
      name: cleanName,
      username: cleanUsername,
      role: req.user.role,
    };

    res.json({
      ok: true,
      user: updatedUser,
      token: signAccessToken(updatedUser),
      refreshToken: signRefreshToken(updatedUser),
    });
  } catch (err) {
    console.error('Update profile failed:', err);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// Protected Admin Directory Endpoint
router.get('/users', requireAuth, requireAdmin, async (req, res) => {
  try {
    const users = await db.queryAll('SELECT id, name, username, email, role, created_at FROM users ORDER BY created_at DESC');
    res.json({ users });
  } catch (err) {
    console.error('List users failed:', err);
    res.status(500).json({ error: 'Failed to fetch user directory' });
  }
});

export default router;
