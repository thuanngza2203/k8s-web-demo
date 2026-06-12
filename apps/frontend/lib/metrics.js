import {
  collectDefaultMetrics,
  Counter,
  Gauge,
  Histogram,
  Registry,
} from 'prom-client';

function createMetrics() {
  const registry = new Registry();
  registry.setDefaultLabels({ service: 'ecommerce-frontend' });

  collectDefaultMetrics({
    register: registry,
    prefix: 'frontend_',
  });

  const pageRendersTotal = new Counter({
    name: 'frontend_page_renders_total',
    help: 'Server-rendered frontend page views',
    labelNames: ['route'],
    registers: [registry],
  });

  const apiRequestsTotal = new Counter({
    name: 'frontend_api_requests_total',
    help: 'Frontend server calls to the API service',
    labelNames: ['method', 'target', 'status_code'],
    registers: [registry],
  });

  const apiRequestDuration = new Histogram({
    name: 'frontend_api_request_duration_seconds',
    help: 'Duration of frontend server calls to the API service',
    labelNames: ['method', 'target', 'status_code'],
    buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [registry],
  });

  const cartItemsGauge = new Gauge({
    name: 'frontend_last_cart_items',
    help: 'Last observed cart item count reported by the frontend server',
    registers: [registry],
  });

  return {
    registry,
    pageRendersTotal,
    apiRequestsTotal,
    apiRequestDuration,
    cartItemsGauge,
  };
}

const globalForMetrics = globalThis;

export const metrics = globalForMetrics.__cloudWebFrontendMetrics
  || createMetrics();

globalForMetrics.__cloudWebFrontendMetrics = metrics;

export function recordPageRender(route) {
  metrics.pageRendersTotal.inc({ route });
}

