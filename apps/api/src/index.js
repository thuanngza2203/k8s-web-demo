require('dotenv').config();

const cors = require('cors');
const express = require('express');
const morgan = require('morgan');

const { client } = require('./metrics');
const metricsMiddleware = require('./middleware/metricsMiddleware');
const errorHandler = require('./middleware/errorHandler');
const migrate = require('./db/migrate');
const seed = require('./db/seed');
const { getPool } = require('./db/connection');
const authRouter = require('./routes/auth');
const productsRouter = require('./routes/products');
const usersRouter = require('./routes/users');
const ordersRouter = require('./routes/orders');
const simulateRouter = require('./routes/simulate');

const app = express();
const PORT = parseInt(process.env.PORT || '8081', 10);

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(morgan('short'));
app.use(metricsMiddleware);

app.get('/metrics', async (_req, res) => {
  try {
    res.set('Content-Type', client.register.contentType);
    res.end(await client.register.metrics());
  } catch (err) {
    res.status(500).end(err.message);
  }
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'ecommerce-api', uptime: process.uptime() });
});

app.get('/ready', async (_req, res) => {
  try {
    await getPool().execute('SELECT 1');
    res.json({ status: 'ready', db: 'connected' });
  } catch (err) {
    res.status(503).json({ status: 'not-ready', db: 'disconnected', message: err.message });
  }
});

app.get('/api/instance', (_req, res) => {
  res.json({
    success: true,
    data: {
      service: 'ecommerce-api',
      pod_name: process.env.POD_NAME || process.env.HOSTNAME || 'local',
      pod_ip: process.env.POD_IP || null,
      node_name: process.env.NODE_NAME || null,
      process_id: process.pid,
      uptime_seconds: Math.round(process.uptime()),
    },
  });
});

app.get('/', (_req, res) => {
  res.json({
    name: 'Cloud Web K8s E-commerce API',
    endpoints: {
      health: 'GET /health',
      ready: 'GET /ready',
      metrics: 'GET /metrics',
      instance: 'GET /api/instance',
      auth: ['POST /api/auth/login', 'POST /api/auth/register', 'GET /api/auth/me'],
      products: 'CRUD /api/products',
      users: 'CRUD /api/users',
      orders: 'CRUD /api/orders',
      simulate: [
        'GET /api/simulate/error',
        'GET /api/simulate/slow?delay=3000',
        'GET /api/simulate/cpu?iterations=10000000',
        'GET /api/simulate/memory?size=100&hold=30',
        'GET /api/simulate/db-error',
      ],
    },
  });
});

app.use('/api/auth', authRouter);
app.use('/api/products', productsRouter);
app.use('/api/users', usersRouter);
app.use('/api/orders', ordersRouter);
app.use('/api/simulate', simulateRouter);

app.use((_req, res) => {
  res.status(404).json({ success: false, error: { message: 'Route not found' } });
});

app.use(errorHandler);

async function waitForDatabase() {
  const retries = parseInt(process.env.DB_STARTUP_RETRIES || '30', 10);

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      await getPool().execute('SELECT 1');
      return;
    } catch (err) {
      console.warn(`Waiting for MySQL (${attempt}/${retries}): ${err.message}`);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  throw new Error('MySQL did not become ready in time');
}

async function start() {
  await waitForDatabase();
  await migrate();
  await seed();

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`E-commerce API listening on 0.0.0.0:${PORT}`);
  });
}

start().catch((err) => {
  console.error('API failed to start:', err);
  process.exit(1);
});
