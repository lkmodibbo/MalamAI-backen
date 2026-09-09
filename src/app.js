const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const authRoutes = require('./routes/auth');
const subjectRoutes = require('./routes/subjects');
const questionRoutes = require('./routes/questions');
const quizRoutes = require('./routes/quiz');
const adminRoutes = require('./routes/admin');
const pastExamRoutes = require('./routes/pastExam');
const leaderboardRoutes = require('./routes/leaderboard');
const notificationRoutes = require('./routes/notification');
const bookmarkRoutes = require('./routes/bookmarks');
const profileRoutes = require('./routes/profile');
const notesRoutes = require('./routes/notes');
const mockExamRoutes = require('./routes/mockExam');

const pool = require('./config/database');
let Sentry;
if (process.env.SENTRY_DSN) {
  try {
    Sentry = require('@sentry/node');
    Sentry.init({ dsn: process.env.SENTRY_DSN });
    console.log('[sentry] initialized');
  } catch (err) {
    console.warn('[sentry] init failed:', err.message);
    Sentry = null;
  }
}

const app = express();

// Platforms like Render and Railway terminate TLS upstream, so the rate limiter
// needs to read the client IP from X-Forwarded-For rather than the socket.
if (process.env.TRUST_PROXY !== 'false') {
  app.set('trust proxy', 1);
}

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json({ limit: '2mb' }));

if (process.env.NODE_ENV !== 'production') {
  app.use((req, _res, next) => {
    console.log(`[${req.method}] ${req.url}`);
    next();
  });
}

const isProd = process.env.NODE_ENV === 'production';

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isProd ? 20 : 200,
  message: { error: isProd ? 'Too many attempts. Please try again in 15 minutes.' : 'Too many attempts. Please slow down (dev).' },
});

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isProd ? 300 : 10000,
  message: { error: 'Too many requests. Please slow down.' },
});

// Reports unhealthy when the database is unreachable so that a deploy platform
// pulls the instance out of rotation instead of serving 500s.
app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({
      status: 'ok',
      database: 'connected',
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[health]', err.message);
    res.status(503).json({
      status: 'degraded',
      database: 'unreachable',
      timestamp: new Date().toISOString(),
    });
  }
});

if (isProd) {
  app.use(globalLimiter);
} else {
  // In development we relax the global limiter to avoid blocking local testing and hot reload activity.
  console.log('[rate-limit] global limiter relaxed for development');
}

app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);

app.use('/api/admin', adminRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/subjects', subjectRoutes);
app.use('/api/questions', questionRoutes);
app.use('/api/quiz', quizRoutes);
app.use('/api/past-exams', pastExamRoutes);
app.use('/api/leaderboard', leaderboardRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/bookmarks', bookmarkRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/notes', notesRoutes);
app.use('/api/mock-exams', mockExamRoutes);

app.use((_req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

app.use((err, _req, res, _next) => {
  console.error('[server error]', err.stack || err.message || err);
  if (Sentry) Sentry.captureException(err);
  res.status(500).json({ error: 'Something went wrong on the server' });
});

module.exports = app;
