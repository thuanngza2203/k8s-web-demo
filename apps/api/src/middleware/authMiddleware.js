const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'cloud-web-k8s-demo-secret-key-2024';

function optionalAuth(req, _res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    req.user = null;
    return next();
  }

  try {
    const token = header.slice(7);
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
  } catch {
    req.user = null;
  }

  return next();
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: { message: 'Authentication required' } });
  }

  try {
    const token = header.slice(7);
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    return next();
  } catch {
    return res.status(401).json({ success: false, error: { message: 'Invalid or expired token' } });
  }
}

module.exports = { optionalAuth, requireAuth, JWT_SECRET };
