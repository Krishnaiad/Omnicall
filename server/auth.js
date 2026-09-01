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

// In-memory revocation set for instant session/ban invalidation (0ms DB-free check)
//
// ⚠️  SINGLE-INSTANCE ONLY: This Set lives in this Node.js process's heap.
// When Render scales beyond 1 instance, a ban issued on instance A will NOT
// propagate to instance B — revoked users can still make requests on other instances.
// Upgrade path (when needed): replace this Set with Redis SADD/SISMEMBER:
//   await redis.sadd('revoked_users', userId);   // on ban/delete
//   await redis.sismember('revoked_users', id);  // in requireAuth
// On free-tier Render (single instance) this is not an issue.
export const revokedUserIds = new Set();


// Consolidated Bootstrap Data Loader (Eliminates 3 post-login cross-region DB round-trips)
export async function fetchUserBootstrapData(userId) {
  try {
    const [rooms, clips, memories] = await Promise.all([
      db.queryAll(
        `SELECT r.id, r.name, r.created_at, rm.role,
          (SELECT COUNT(*)::int FROM room_members WHERE room_id = r.id) AS member_count
         FROM rooms r
         JOIN room_members rm ON rm.room_id = r.id
         WHERE rm.user_id = ?
         ORDER BY r.created_at DESC`,
        [userId]
      ).catch(() => []),
      db.queryAll(
        'SELECT id, name, mime_type, file_size, storage_provider, public_url, status, created_at FROM media_files WHERE user_id = ? ORDER BY created_at DESC',
        [userId]
      ).catch(() => []),
      db.queryAll(
        'SELECT id, room_id, room_name, media_url, caption, created_at FROM room_memories WHERE user_id = ? ORDER BY created_at DESC',
        [userId]
      ).catch(() => []),
    ]);
    return { rooms: rooms || [], clips: clips || [], memories: memories || [] };
  } catch {
    return { rooms: [], clips: [], memories: [] };
  }
}



import nodemailer from 'nodemailer';

// Helper to create email transporter with graceful fallback
function getEmailTransporter() {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER || process.env.GMAIL_USER;
  const pass = process.env.SMTP_PASS || process.env.GMAIL_PASS;

  if (host && user && pass) {
    return nodemailer.createTransport({
      host,
      port: parseInt(process.env.SMTP_PORT || '587', 10),
      secure: process.env.SMTP_SECURE === 'true',
      auth: { user, pass },
    });
  }

  if (user && pass) {
    return nodemailer.createTransport({
      service: 'gmail',
      auth: { user, pass },
    });
  }

  return null;
}

// Send OTP Verification Email
async function sendOtpEmail(recipientEmail, otpCode) {
  const transporter = getEmailTransporter();
  const fromAddress = process.env.SMTP_FROM || process.env.GMAIL_USER || 'no-reply@omnicall.com';

  console.log(`\n======================================================`);
  console.log(`🔑 [OmniCall Security] 6-Digit Signup OTP Code: ${otpCode}`);
  console.log(`📧 Target Email: ${recipientEmail}`);
  console.log(`======================================================\n`);

  if (!transporter) {
    return { sent: false, devMode: true };
  }

  try {
    await transporter.sendMail({
      from: `"OmniCall Security" <${fromAddress}>`,
      to: recipientEmail,
      subject: `Your OmniCall Verification Code: ${otpCode}`,
      html: `
        <div style="font-family: Arial, sans-serif; background: #070a13; color: #fff; padding: 24px; border-radius: 12px;">
          <h2 style="color: #818cf8; margin-bottom: 12px;">OmniCall Account Verification</h2>
          <p style="color: #cbd5e1; font-size: 15px;">Please use the following 6-digit verification code to complete your signup:</p>
          <div style="font-size: 32px; font-weight: bold; letter-spacing: 6px; color: #ec4899; background: rgba(255,255,255,0.05); padding: 12px 20px; border-radius: 8px; display: inline-block; margin: 16px 0;">
            ${otpCode}
          </div>
          <p style="color: #94a3b8; font-size: 13px;">This code is valid for 10 minutes. If you did not request this, please ignore this email.</p>
        </div>
      `,
    });
    return { sent: true };
  } catch (err) {
    console.warn('[Email Transporter Notice]:', err.message);
    return { sent: false, error: err.message };
  }
}

// ─── Step 1: Send OTP to Email ──────────────────────────────────────────────
router.post('/send-otp', async (req, res) => {
  const { email } = req.body || {};

  if (!email || !EMAIL_RE.test(email)) {
    return res.status(400).json({ error: 'A valid email address is required' });
  }

  const normalizedEmail = email.toLowerCase().trim();

  try {
    const existing = await db.queryGet('SELECT id FROM users WHERE email = ?', [normalizedEmail]);
    if (existing) {
      return res.status(409).json({ error: 'An account with this email already exists' });
    }

    // Generate random 6-digit numeric OTP
    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    const otpId = randomUUID();

    // 10-minute expiry timestamp
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    // Clean up old OTPs for this email
    await db.queryRun('DELETE FROM verification_otps WHERE email = ?', [normalizedEmail]);

    // Store in DB
    await db.queryRun(
      'INSERT INTO verification_otps (id, email, otp_code, expires_at) VALUES (?, ?, ?, ?)',
      [otpId, normalizedEmail, otpCode, expiresAt]
    );

    // Send email (or log to server console)
    const emailResult = await sendOtpEmail(normalizedEmail, otpCode);

    res.json({
      ok: true,
      message: 'Verification code sent to your email.',
      expiresInMinutes: 10,
      devMode: emailResult.devMode || false,
      devOtp: emailResult.devMode ? otpCode : undefined, // Provided in dev mode when SMTP not configured
    });
  } catch (err) {
    console.error('Send OTP failed:', err);
    res.status(500).json({ error: 'Failed to send verification code' });
  }
});

// ─── Step 2: Verify OTP and Complete Registration ───────────────────────────
router.post('/verify-otp-register', async (req, res) => {
  try {
    const { email, otp, password, name, username } = req.body || {};

    if (!email || !otp || !password || !name) {
      return res.status(400).json({ error: 'Email, verification code, password, and name are required' });
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
    const cleanOtp = String(otp).trim();

    // 1. Verify OTP in database
    const otpRecord = await db.queryGet(
      'SELECT id, expires_at FROM verification_otps WHERE email = ? AND otp_code = ?',
      [normalizedEmail, cleanOtp]
    );

    if (!otpRecord) {
      return res.status(400).json({ error: 'Invalid verification code. Please check and try again.' });
    }

    const isExpired = new Date(otpRecord.expires_at).getTime() < Date.now();
    if (isExpired) {
      await db.queryRun('DELETE FROM verification_otps WHERE id = ?', [otpRecord.id]);
      return res.status(400).json({ error: 'Verification code has expired. Please request a new code.' });
    }

    // 2. Check if email exists
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

    // Delete verified OTP record
    await db.queryRun('DELETE FROM verification_otps WHERE email = ?', [normalizedEmail]);

    const user = { id, email: normalizedEmail, name: name.trim(), username: assignedUsername, role: assignedRole };
    const accessToken = signAccessToken(user);
    const refreshToken = signRefreshToken(user);

    invalidateUsersCache();
    res.status(201).json({ token: accessToken, refreshToken, user, bootstrap: { rooms: [], clips: [], memories: [] } });
  } catch (err) {
    console.error('Verify OTP register failed:', err);
    res.status(500).json({ error: 'Registration failed: ' + err.message });
  }
});

// Legacy direct registration endpoint (preserved for backwards compatibility)
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

    invalidateUsersCache();
    res.status(201).json({ token: accessToken, refreshToken, user, bootstrap: { rooms: [], clips: [], memories: [] } });
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
    // Explicit column list: never expose password_hash outside this comparison
    const row = await db.queryGet(
      'SELECT id, email, name, username, role, password_hash FROM users WHERE email = ?',
      [normalizedEmail]
    );

    const valid = row ? await bcrypt.compare(password, row.password_hash) : false;

    if (!row || !valid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const user = { id: row.id, email: row.email, name: row.name, username: row.username, role: row.role || 'user' };
    const accessToken = signAccessToken(user);
    const refreshToken = signRefreshToken(user);

    // Fetch bootstrap payload in parallel to eliminate 3 post-login cross-region roundtrips
    const bootstrap = await fetchUserBootstrapData(row.id);

    res.json({ token: accessToken, refreshToken, user, bootstrap });
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
    if (payload.type !== 'refresh' || !payload.sub || revokedUserIds.has(payload.sub)) {
      return res.status(401).json({ error: 'Invalid or revoked refresh token' });
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
    const bootstrap = await fetchUserBootstrapData(user.id);

    res.json({ token: newAccessToken, refreshToken: newRefreshToken, user, bootstrap });
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
    if (revokedUserIds.has(payload.sub)) {
      return res.status(401).json({ error: 'Session has been revoked or account deleted.' });
    }
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
    const currentUser = await db.queryGet('SELECT id, username FROM users WHERE id = ?', [req.user.id]);
    
    // Only check collision if user is actually changing to a new username
    if (!currentUser || currentUser.username.toLowerCase() !== cleanUsername) {
      const existing = await db.queryGet(
        'SELECT id FROM users WHERE LOWER(username) = ? AND id != ?',
        [cleanUsername, req.user.id]
      );

      if (existing) {
        return res.status(409).json({ error: `Username "@${cleanUsername}" is already taken. Please choose another username.` });
      }
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

let usersCache = null;
let usersCacheTime = 0;
export const invalidateUsersCache = () => { usersCache = null; };


// Registered Accounts Directory Endpoint (Available to all logged-in team members)
router.get('/users', requireAuth, async (req, res) => {
  try {
    const now = Date.now();
    if (usersCache && (now - usersCacheTime < 30000)) {
      return res.json({ users: usersCache });
    }
    const users = await db.queryAll('SELECT id, name, username, email, role, created_at FROM users ORDER BY created_at DESC');
    usersCache = users;
    usersCacheTime = now;
    res.json({ users });
  } catch (err) {
    console.error('List users failed:', err);
    res.status(500).json({ error: 'Failed to fetch user directory' });
  }
});

// Admin Delete Normal User Endpoint (Admin Only)
router.delete('/users/:userId', requireAuth, requireAdmin, async (req, res) => {
  const { userId } = req.params;


  if (userId === req.user.id) {
    return res.status(400).json({ error: 'Admins cannot delete their own account.' });
  }

  try {
    const target = await db.queryGet('SELECT id, role, username FROM users WHERE id = ?', [userId]);
    if (!target) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (target.role === 'admin') {
      return res.status(403).json({ error: 'Cannot delete an admin account.' });
    }

    // Clean up all related records
    await db.queryRun('DELETE FROM room_memories WHERE user_id = ?', [userId]).catch(() => {});
    await db.queryRun('DELETE FROM media_files WHERE user_id = ?', [userId]).catch(() => {});
    await db.queryRun('DELETE FROM room_members WHERE user_id = ?', [userId]).catch(() => {});
    await db.queryRun('DELETE FROM chat_messages WHERE sender_id = ?', [userId]).catch(() => {});
    await db.queryRun('DELETE FROM hand_raises WHERE user_id = ?', [userId]).catch(() => {});
    await db.queryRun('DELETE FROM poll_votes WHERE user_id = ?', [userId]).catch(() => {});
    await db.queryRun('DELETE FROM live_sessions WHERE user_id = ?', [userId]).catch(() => {});
    await db.queryRun('DELETE FROM rooms WHERE owner_id = ?', [userId]).catch(() => {});
    await db.queryRun('DELETE FROM users WHERE id = ?', [userId]);

    revokedUserIds.add(userId);
    invalidateUsersCache();

    res.json({ ok: true, message: `User @${target.username} has been deleted permanently.` });
  } catch (err) {
    console.error('Delete user failed:', err);
    res.status(500).json({ error: 'Failed to delete user' });
  }

});



export default router;
