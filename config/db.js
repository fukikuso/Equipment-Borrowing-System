const mysql = require('mysql2/promise');
require('dotenv').config();

const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'cspc_ebs',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  dateStrings: true
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
