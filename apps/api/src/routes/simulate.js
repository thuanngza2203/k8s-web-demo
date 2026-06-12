const { Router } = require('express');
const { appEventsTotal, simulatedMemoryBytes } = require('../metrics');
const { query } = require('../db/connection');

const router = Router();
const retainedBuffers = [];

function refreshMemoryGauge() {
  const bytes = retainedBuffers.reduce((sum, item) => sum + item.buffer.length, 0);
  simulatedMemoryBytes.set(bytes);
}

router.get('/error', (_req, res) => {
  const variants = [
    { status: 500, message: 'Internal Server Error (simulated)' },
    { status: 502, message: 'Bad Gateway (simulated)' },
    { status: 503, message: 'Service Unavailable (simulated)' },
  ];
  const error = variants[Math.floor(Math.random() * variants.length)];
  appEventsTotal.inc({ event_type: 'simulated_error' });
  res.status(error.status).json({ success: false, error });
});

router.get('/slow', async (req, res) => {
  const delay = Math.min(parseInt(req.query.delay || '3000', 10), 30000);
  appEventsTotal.inc({ event_type: 'simulated_slow' });
  await new Promise((resolve) => setTimeout(resolve, delay));
  res.json({ success: true, message: `Responded after ${delay}ms` });
});

router.get('/cpu', (req, res) => {
  const iterations = Math.min(parseInt(req.query.iterations || '1000000', 10), 60000000);
  appEventsTotal.inc({ event_type: 'simulated_cpu' });

  let result = 0;
  for (let i = 0; i < iterations; i += 1) {
    result += Math.sqrt(i) * Math.sin(i);
  }

  res.json({ success: true, message: `CPU work complete (${iterations} iterations)`, result });
});

router.get('/memory', (req, res) => {
  const sizeMb = Math.min(parseInt(req.query.size || '100', 10), 300);
  const holdSeconds = Math.min(parseInt(req.query.hold || '30', 10), 180);
  const buffer = Buffer.alloc(sizeMb * 1024 * 1024, 'm');
  const record = { buffer };

  retainedBuffers.push(record);
  refreshMemoryGauge();
  appEventsTotal.inc({ event_type: 'simulated_memory' });

  setTimeout(() => {
    const index = retainedBuffers.indexOf(record);
    if (index >= 0) {
      retainedBuffers.splice(index, 1);
      refreshMemoryGauge();
    }
  }, holdSeconds * 1000).unref();

  res.json({
    success: true,
    message: `Retaining ${sizeMb}MB for ${holdSeconds}s`,
    retained_bytes: buffer.length,
  });
});

router.get('/db-error', async (_req, res) => {
  try {
    await query(
      'SELECT * FROM intentionally_missing_table_for_db_failure_demo',
      [],
      'SELECT',
      'db_failure_demo'
    );
  } catch (err) {
    appEventsTotal.inc({ event_type: 'simulated_db_error' });
    return res.status(500).json({
      success: false,
      error: {
        status: 500,
        message: 'Database failure simulated',
        detail: err.message,
      },
    });
  }

  return res.status(500).json({
    success: false,
    error: { status: 500, message: 'Expected simulated DB failure did not occur' },
  });
});

module.exports = router;
