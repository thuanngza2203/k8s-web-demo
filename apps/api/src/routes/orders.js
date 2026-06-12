const { Router } = require('express');
const { randomUUID } = require('crypto');
const { getPool, query } = require('../db/connection');
const { appEventsTotal, dbQueriesTotal, dbQueryDuration } = require('../metrics');
const { optionalAuth, requireAuth } = require('../middleware/authMiddleware');

const router = Router();

router.get('/', requireAuth, async (req, res, next) => {
  try {
    const params = [];
    const conditions = [];

    if (req.query.status) {
      conditions.push('o.status = ?');
      params.push(req.query.status);
    }

    conditions.push('o.user_uuid = ?');
    params.push(req.user.uuid);

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const [orders] = await query(
      `SELECT o.uuid, o.user_uuid, o.status, o.total_price, o.created_at,
              u.username AS customer, u.full_name AS customer_name
       FROM orders o
       LEFT JOIN users u ON u.uuid = o.user_uuid
       ${where}
       ORDER BY o.id DESC
       LIMIT 50`,
      params,
      'SELECT',
      'orders'
    );

    if (orders.length === 0) {
      return res.json({ success: true, count: 0, data: [] });
    }

    const orderUuids = orders.map((order) => order.uuid);
    const placeholders = orderUuids.map(() => '?').join(',');
    const [items] = await query(
      `SELECT oi.order_uuid, oi.product_uuid, oi.quantity, oi.unit_price,
              p.name, p.image_url
       FROM order_items oi
       LEFT JOIN products p ON p.uuid = oi.product_uuid
       WHERE oi.order_uuid IN (${placeholders})`,
      orderUuids,
      'SELECT',
      'order_items'
    );

    const itemsByOrder = items.reduce((acc, item) => {
      acc[item.order_uuid] = acc[item.order_uuid] || [];
      acc[item.order_uuid].push(item);
      return acc;
    }, {});

    return res.json({
      success: true,
      count: orders.length,
      data: orders.map((order) => ({ ...order, items: itemsByOrder[order.uuid] || [] })),
    });
  } catch (err) {
    return next(err);
  }
});

router.post('/', optionalAuth, async (req, res, next) => {
  const pool = getPool();
  let connection;
  const orderUuid = randomUUID();
  const endTimer = dbQueryDuration.startTimer({ operation: 'TRANSACTION', table: 'orders' });

  try {
    connection = await pool.getConnection();
    const { user_uuid, items } = req.body;

    // Use JWT user if available, otherwise fall back to body user_uuid
    const buyerUuid = (req.user && req.user.uuid) || user_uuid;

    if (!buyerUuid || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        success: false,
        error: { message: 'user authentication (or user_uuid) and at least one order item are required' },
      });
    }

    await connection.beginTransaction();

    const [users] = await connection.execute('SELECT uuid FROM users WHERE uuid = ?', [buyerUuid]);
    if (users.length === 0) {
      await connection.rollback();
      return res.status(404).json({ success: false, error: { message: 'User not found' } });
    }

    let totalPrice = 0;
    const normalizedItems = [];

    for (const item of items) {
      const quantity = Math.max(parseInt(item.quantity || '1', 10), 1);
      const [products] = await connection.execute(
        'SELECT uuid, price, stock FROM products WHERE uuid = ? FOR UPDATE',
        [item.product_uuid]
      );

      if (products.length === 0) {
        await connection.rollback();
        return res.status(404).json({ success: false, error: { message: `Product not found: ${item.product_uuid}` } });
      }

      const product = products[0];
      if (product.stock < quantity) {
        await connection.rollback();
        return res.status(400).json({
          success: false,
          error: { message: `Insufficient stock for product ${item.product_uuid}` },
        });
      }

      const unitPrice = Number(product.price);
      totalPrice += unitPrice * quantity;
      normalizedItems.push({ product_uuid: product.uuid, quantity, unit_price: unitPrice });
    }

    await connection.execute(
      'INSERT INTO orders (uuid, user_uuid, status, total_price) VALUES (?, ?, ?, ?)',
      [orderUuid, buyerUuid, 'pending', totalPrice.toFixed(2)]
    );

    for (const item of normalizedItems) {
      await connection.execute(
        'INSERT INTO order_items (order_uuid, product_uuid, quantity, unit_price) VALUES (?, ?, ?, ?)',
        [orderUuid, item.product_uuid, item.quantity, item.unit_price]
      );
      await connection.execute(
        'UPDATE products SET stock = stock - ? WHERE uuid = ?',
        [item.quantity, item.product_uuid]
      );
    }

    await connection.commit();
    dbQueriesTotal.inc({ operation: 'TRANSACTION', table: 'orders', success: 'true' });
    appEventsTotal.inc({ event_type: 'order_placed' });

    return res.status(201).json({
      success: true,
      data: {
        uuid: orderUuid,
        user_uuid: buyerUuid,
        status: 'pending',
        total_price: Number(totalPrice.toFixed(2)),
        items: normalizedItems,
      },
    });
  } catch (err) {
    if (connection) {
      await connection.rollback();
    }
    dbQueriesTotal.inc({ operation: 'TRANSACTION', table: 'orders', success: 'false' });
    return next(err);
  } finally {
    endTimer();
    if (connection) {
      connection.release();
    }
  }
});

router.patch('/:uuid/status', async (req, res, next) => {
  try {
    const validStatuses = ['pending', 'processing', 'shipped', 'delivered', 'cancelled'];
    const { status } = req.body;

    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        error: { message: `status must be one of: ${validStatuses.join(', ')}` },
      });
    }

    const [result] = await query(
      'UPDATE orders SET status = ? WHERE uuid = ?',
      [status, req.params.uuid],
      'UPDATE',
      'orders'
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, error: { message: 'Order not found' } });
    }

    appEventsTotal.inc({ event_type: `order_${status}` });
    return res.json({ success: true, message: `Order status updated to ${status}` });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
