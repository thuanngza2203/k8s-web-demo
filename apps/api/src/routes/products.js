const { Router } = require('express');
const { randomUUID } = require('crypto');
const { query } = require('../db/connection');
const { appEventsTotal } = require('../metrics');

const router = Router();

router.get('/categories', async (_req, res, next) => {
  try {
    const [rows] = await query(
      'SELECT DISTINCT category, COUNT(*) as count FROM products GROUP BY category ORDER BY category',
      [],
      'SELECT',
      'products'
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    next(err);
  }
});

router.get('/', async (req, res, next) => {
  try {
    const params = [];
    const conditions = [];

    if (req.query.category) {
      conditions.push('category = ?');
      params.push(req.query.category);
    }

    if (req.query.search) {
      conditions.push('(name LIKE ? OR description LIKE ?)');
      const term = `%${req.query.search}%`;
      params.push(term, term);
    }

    let sql = `
      SELECT uuid, name, description, price, stock, category, image_url, created_at
      FROM products
    `;

    if (conditions.length > 0) {
      sql += ` WHERE ${conditions.join(' AND ')}`;
    }

    sql += ' ORDER BY id DESC';
    const [rows] = await query(sql, params, 'SELECT', 'products');
    res.json({ success: true, count: rows.length, data: rows });
  } catch (err) {
    next(err);
  }
});

router.get('/:uuid', async (req, res, next) => {
  try {
    const [rows] = await query(
      `SELECT uuid, name, description, price, stock, category, image_url, created_at
       FROM products
       WHERE uuid = ?`,
      [req.params.uuid],
      'SELECT',
      'products'
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, error: { message: 'Product not found' } });
    }

    return res.json({ success: true, data: rows[0] });
  } catch (err) {
    return next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const { name, description, price, stock, category, image_url } = req.body;
    if (!name || price === undefined) {
      return res.status(400).json({ success: false, error: { message: 'name and price are required' } });
    }

    const uuid = randomUUID();
    await query(
      `INSERT INTO products
        (uuid, name, description, price, stock, category, image_url)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [uuid, name, description || null, price, stock || 0, category || 'general', image_url || null],
      'INSERT',
      'products'
    );

    appEventsTotal.inc({ event_type: 'product_created' });
    return res.status(201).json({
      success: true,
      data: { uuid, name, description, price, stock: stock || 0, category: category || 'general', image_url },
    });
  } catch (err) {
    return next(err);
  }
});

router.put('/:uuid', async (req, res, next) => {
  try {
    const { name, description, price, stock, category, image_url } = req.body;
    const [result] = await query(
      `UPDATE products SET
        name = COALESCE(?, name),
        description = COALESCE(?, description),
        price = COALESCE(?, price),
        stock = COALESCE(?, stock),
        category = COALESCE(?, category),
        image_url = COALESCE(?, image_url)
       WHERE uuid = ?`,
      [
        name || null,
        description || null,
        price ?? null,
        stock ?? null,
        category || null,
        image_url || null,
        req.params.uuid,
      ],
      'UPDATE',
      'products'
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, error: { message: 'Product not found' } });
    }

    appEventsTotal.inc({ event_type: 'product_updated' });
    return res.json({ success: true, message: 'Product updated' });
  } catch (err) {
    return next(err);
  }
});

router.delete('/:uuid', async (req, res, next) => {
  try {
    const [result] = await query(
      'DELETE FROM products WHERE uuid = ?',
      [req.params.uuid],
      'DELETE',
      'products'
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, error: { message: 'Product not found' } });
    }

    appEventsTotal.inc({ event_type: 'product_deleted' });
    return res.json({ success: true, message: 'Product deleted' });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
