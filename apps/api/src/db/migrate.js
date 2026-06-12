require('dotenv').config();

const { getPool } = require('./connection');
const { TABLES } = require('./schema');

async function migrate() {
  const pool = getPool();
  for (const sql of TABLES) {
    await pool.execute(sql);
  }
}

if (require.main === module) {
  migrate()
    .then(async () => {
      console.log('Migrations complete.');
      await getPool().end();
      process.exit(0);
    })
    .catch((err) => {
      console.error('Migration failed:', err);
      process.exit(1);
    });
}

module.exports = migrate;

