const {
  activeRequests,
  httpErrorsTotal,
  httpRequestDuration,
  httpRequestsTotal,
} = require('../metrics');

function normaliseRoute(req) {
  if (req.route && req.route.path) {
    return `${req.baseUrl}${req.route.path}`;
  }

  return req.originalUrl
    .split('?')[0]
    .replace(
      /\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
      '/:uuid'
    )
    .replace(/\/\d+/g, '/:id');
}

function metricsMiddleware(req, res, next) {
  if (req.path === '/metrics') {
    return next();
  }

  activeRequests.inc();
  const endTimer = httpRequestDuration.startTimer();

  res.on('finish', () => {
    const labels = {
      method: req.method,
      route: normaliseRoute(req),
      status_code: String(res.statusCode),
    };

    httpRequestsTotal.inc(labels);
    endTimer(labels);
    activeRequests.dec();

    if (res.statusCode >= 400) {
      httpErrorsTotal.inc(labels);
    }
  });

  return next();
}

module.exports = metricsMiddleware;

