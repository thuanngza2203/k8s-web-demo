const { Router } = require('express');
const { randomUUID } = require('crypto');
const { query } = require('../db/connection');
const { appEventsTotal } = require('../metrics');

const router = Router();

router.get('/', async (_req, res, next) => {
  try {
    const [rows] = await query(
      'SELECT uuid, username, email, full_name, role, created_at FROM users ORDER BY id DESC',
      [],
      'SELECT',
      'users'
    );
    res.json({ success: true, count: rows.length, data: rows });
  } catch (err) {
    next(err);
  }
});

router.get('/:uuid', async (req, res, next) => {
  try {
    const [rows] = await query(
      'SELECT uuid, username, email, full_name, role, created_at FROM users WHERE uuid = ?',
      [req.params.uuid],
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

router.post('/', async (req, res, next) => {
  try {
    const { username, email, full_name, role } = req.body;
    if (!username || !email) {
      return res.status(400).json({ success: false, error: { message: 'username and email are required' } });
    }

    const uuid = randomUUID();
    await query(
      'INSERT INTO users (uuid, username, email, full_name, role) VALUES (?, ?, ?, ?, ?)',
      [uuid, username, email, full_name || null, role || 'customer'],
      'INSERT',
      'users'
    );

    appEventsTotal.inc({ event_type: 'user_created' });
    return res.status(201).json({
      success: true,
      data: { uuid, username, email, full_name, role: role || 'customer' },
    });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ success: false, error: { message: 'username or email already exists' } });
    }
    return next(err);
  }
});

module.exports = router;

