const client = require('prom-client');

const PREFIX = process.env.METRICS_PREFIX || 'app_';

client.collectDefaultMetrics({
  prefix: PREFIX,
  labels: {
    service: 'ecommerce-api',
  },
});

const httpRequestsTotal = new client.Counter({
  name: `${PREFIX}http_requests_total`,
  help: 'Total HTTP requests received by the API',
  labelNames: ['method', 'route', 'status_code'],
});

const httpErrorsTotal = new client.Counter({
  name: `${PREFIX}http_errors_total`,
  help: 'Total HTTP error responses from the API',
  labelNames: ['method', 'route', 'status_code'],
});

const httpRequestDuration = new client.Histogram({
  name: `${PREFIX}http_request_duration_seconds`,
  help: 'API HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
});

const activeRequests = new client.Gauge({
  name: `${PREFIX}active_requests`,
  help: 'Number of in-flight HTTP requests',
});

const dbQueriesTotal = new client.Counter({
  name: `${PREFIX}db_queries_total`,
  help: 'Total database queries executed by the API',
  labelNames: ['operation', 'table', 'success'],
});

const dbQueryDuration = new client.Histogram({
  name: `${PREFIX}db_query_duration_seconds`,
  help: 'Database query duration in seconds',
  labelNames: ['operation', 'table'],
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
});

const dbPoolConnections = new client.Gauge({
  name: `${PREFIX}db_pool_connections`,
  help: 'Total connections currently opened by the MySQL pool',
});

const appEventsTotal = new client.Counter({
  name: `${PREFIX}events_total`,
  help: 'Business-level events in the demo application',
  labelNames: ['event_type'],
});

const simulatedMemoryBytes = new client.Gauge({
  name: `${PREFIX}simulated_memory_bytes`,
  help: 'Bytes intentionally retained by the memory simulation endpoint',
});

module.exports = {
  client,
  httpRequestsTotal,
  httpErrorsTotal,
  httpRequestDuration,
  activeRequests,
  dbQueriesTotal,
  dbQueryDuration,
  dbPoolConnections,
  appEventsTotal,
  simulatedMemoryBytes,
};

