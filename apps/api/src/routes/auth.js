const { Router } = require('express');
const jwt = require('jsonwebtoken');
const { randomUUID } = require('crypto');
const { query } = require('../db/connection');
const { appEventsTotal } = require('../metrics');
const { requireAuth, JWT_SECRET } = require('../middleware/authMiddleware');

const router = Router();
const TOKEN_EXPIRY = '24h';

router.post('/login', async (req, res, next) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ success: false, error: { message: 'username and password are required' } });
    }

    const [rows] = await query(
      'SELECT uuid, username, email, full_name, avatar_url, role, password_hash FROM users WHERE username = ?',
      [username],
      'SELECT',
      'users'
    );

    if (rows.length === 0) {
      return res.status(401).json({ success: false, error: { message: 'Invalid username or password' } });
    }

    const user = rows[0];
    if (user.password_hash !== password) {
      return res.status(401).json({ success: false, error: { message: 'Invalid username or password' } });
    }

    const token = jwt.sign(
      { uuid: user.uuid, username: user.username, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: TOKEN_EXPIRY }
    );

    appEventsTotal.inc({ event_type: 'user_login' });

    return res.json({
      success: true,
      data: {
        token,
        user: {
          uuid: user.uuid,
          username: user.username,
          email: user.email,
          full_name: user.full_name,
          avatar_url: user.avatar_url,
          role: user.role,
        },
      },
    });
  } catch (err) {
    return next(err);
  }
});

router.post('/register', async (req, res, next) => {
  try {
    const { username, email, password, full_name } = req.body;
    if (!username || !email || !password) {
      return res.status(400).json({
        success: false,
        error: { message: 'username, email, and password are required' },
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        error: { message: 'password must be at least 6 characters' },
      });
    }

    const uuid = randomUUID();
    const avatarUrl = `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(username)}`;

    await query(
      `INSERT INTO users (uuid, username, email, password_hash, full_name, avatar_url, role)
       VALUES (?, ?, ?, ?, ?, ?, 'customer')`,
      [uuid, username, email, password, full_name || null, avatarUrl],
      'INSERT',
      'users'
    );

    const token = jwt.sign(
      { uuid, username, email, role: 'customer' },
      JWT_SECRET,
      { expiresIn: TOKEN_EXPIRY }
    );

    appEventsTotal.inc({ event_type: 'user_registered' });

    return res.status(201).json({
      success: true,
      data: {
        token,
        user: {
          uuid,
          username,
          email,
          full_name: full_name || null,
          avatar_url: avatarUrl,
          role: 'customer',
        },
      },
    });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ success: false, error: { message: 'Username or email already exists' } });
    }
    return next(err);
  }
});

router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const [rows] = await query(
      'SELECT uuid, username, email, full_name, avatar_url, role, created_at FROM users WHERE uuid = ?',
      [req.user.uuid],
      'SELECT',
      'users'
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, error: { message: 'User not found' } });
    }

    return res.json({ success: true, data: rows[0] });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
