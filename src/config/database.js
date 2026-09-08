const { Pool } = require('pg');
require('dotenv').config();

// Managed Postgres providers hand out a single connection URL and require TLS,
// while local development uses discrete host/port/user variables. Support both.
const connectionString = process.env.DATABASE_URL;

// Explicit settings win: DB_SSL, then an sslmode in the URL. Otherwise assume
// TLS only in production, so a local Docker Postgres keeps working as-is.
function resolveSsl() {
  if (process.env.DB_SSL) return process.env.DB_SSL !== 'false';

  const sslmode = /[?&]sslmode=([^&]+)/.exec(connectionString || '')?.[1];
  if (sslmode) return sslmode !== 'disable';

  return process.env.NODE_ENV === 'production' && Boolean(connectionString);
}

const useSsl = resolveSsl();

const pool = new Pool({
  ...(connectionString
    ? { connectionString }
    : {
        host: process.env.DB_HOST,
        port: process.env.DB_PORT,
        database: process.env.DB_NAME,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
      }),
  ssl: useSsl ? { rejectUnauthorized: false } : false,
  max: Number(process.env.DB_POOL_MAX || 10),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

// An error on an idle client would otherwise be an unhandled 'error' event and
// take the process down.
pool.on('error', (err) => {
  console.error('[db] idle client error:', err.message);
});

module.exports = pool;
