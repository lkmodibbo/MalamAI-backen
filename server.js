require('dotenv').config();

const app = require('./src/app');
const pool = require('./src/config/database');
const migrate = require('./src/db/migrate');

const PORT = process.env.PORT || 5000;

// Fail loudly at boot rather than with confusing 403s on the first request.
function assertRequiredEnv() {
  const missing = [];

  if (!process.env.JWT_SECRET) missing.push('JWT_SECRET');
  if (!process.env.DATABASE_URL && !process.env.DB_NAME) {
    missing.push('DATABASE_URL (or DB_HOST/DB_NAME/DB_USER/DB_PASSWORD)');
  }

  if (missing.length > 0) {
    console.error(
      `Missing required environment variable(s): ${missing.join(', ')}.\n` +
      'Copy .env.example to .env and fill it in before starting the server.'
    );
    process.exit(1);
  }
}

async function start() {
  assertRequiredEnv();

  await migrate();

  const server = app.listen(PORT, () => {
    console.log(`CrackJAMB backend running on http://localhost:${PORT}`);
  });

  // Stop accepting connections and drain the pool so in-flight queries finish
  // before the process exits.
  const shutdown = (signal) => {
    console.log(`[server] ${signal} received, shutting down`);
    server.close(async () => {
      try {
        await pool.end();
      } catch (err) {
        console.error('[server] error closing database pool:', err.message);
      }
      process.exit(0);
    });

    setTimeout(() => {
      console.error('[server] forced shutdown after timeout');
      process.exit(1);
    }, 10000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

start().catch((err) => {
  console.error('Startup failed:', err);
  process.exit(1);
});
