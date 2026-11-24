const mysql = require('mysql2/promise');
require('dotenv').config();

const isProduction = process.env.NODE_ENV === 'production';

if (isProduction) {
  const missingVariables = ['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME']
    .filter((name) => !process.env[name]);

  if (missingVariables.length) {
    throw new Error(`Missing production database environment variables: ${missingVariables.join(', ')}`);
  }
  if (process.env.DB_USER.toLowerCase() === 'root') {
    throw new Error('Production database connections must use a non-root DB_USER.');
  }
}

const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'cspc_ebs',
  waitForConnections: true,
  connectionLimit: 5,
  queueLimit: 0,
  dateStrings: true,
  ssl: isProduction
    ? {
        rejectUnauthorized: true,
        ca: process.env.DB_SSL_CA || undefined
      }
    : undefined
});

// Quick sanity check on boot so setup mistakes fail loudly and clearly.
(async () => {
  try {
    const conn = await pool.getConnection();
    await conn.ping();
    conn.release();
    console.log('[DB] Connected to MySQL database "%s" at %s:%s', process.env.DB_NAME, process.env.DB_HOST, process.env.DB_PORT);
  } catch (err) {
    console.error('[DB] Could not connect to MySQL. Is XAMPP MySQL running and did you import database/schema.sql?');
    console.error('[DB] Error:', err.message);
  }
})();

module.exports = pool;
