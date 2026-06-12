const mysql = require('mysql2/promise');
const {
  dbPoolConnections,
  dbQueriesTotal,
  dbQueryDuration,
} = require('../metrics');

let pool;

function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '3306', 10),
      user: process.env.DB_USER || 'app_user',
      password: process.env.DB_PASSWORD || 'app_password',
      database: process.env.DB_NAME || 'ecommerce_demo',
      waitForConnections: true,
      connectionLimit: parseInt(process.env.DB_POOL_LIMIT || '10', 10),
      queueLimit: 0,
      enableKeepAlive: true,
      keepAliveInitialDelay: 10000,
    });

    setInterval(() => {
      const internalPool = pool.pool;
      const count = internalPool && internalPool._allConnections
        ? internalPool._allConnections.length
        : 0;
      dbPoolConnections.set(count);
    }, 5000).unref();
  }

  return pool;
}

async function query(sql, params = [], operation = 'UNKNOWN', table = 'unknown') {
  const endTimer = dbQueryDuration.startTimer({ operation, table });

  try {
    const result = await getPool().execute(sql, params);
    dbQueriesTotal.inc({ operation, table, success: 'true' });
    return result;
  } catch (err) {
    dbQueriesTotal.inc({ operation, table, success: 'false' });
    throw err;
  } finally {
    endTimer();
  }
}

module.exports = {
  getPool,
  query,
};

