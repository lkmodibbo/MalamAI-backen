const express    = require('express');
const cors       = require('cors');
const rateLimit  = require('express-rate-limit');
require('dotenv').config();

const authRoutes     = require('./src/routes/auth');
const subjectRoutes  = require('./src/routes/subjects');
const questionRoutes = require('./src/routes/questions');
const quizRoutes     = require('./src/routes/quiz');
const adminRoutes    = require('./src/routes/admin');
const pastExamRoutes = require('./src/routes/pastExam');
const leaderboardRoutes   = require('./src/routes/leaderboard');
const notificationRoutes =  require('./src/routes/notification');
const bookmarkRoutes = require('./src/routes/bookmarks');
const helmet     = require('helmet');


const app  = express();
const PORT = process.env.PORT || 5000;

// ── Middleware ──────────────────────────────────────
app.use(cors());
app.use(express.json());

// Request logger (remove after debugging)
app.use((req, _res, next) => {
  console.log(`[${req.method}] ${req.url}`);
  next();
});

// Rate limiter for auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max:      20,
  message:  { error: 'Too many attempts. Please try again in 15 minutes.' },
});
app.use('/api/auth/login',    authLimiter);
app.use('/api/auth/register', authLimiter);

// ── Routes ──────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', message: 'CrackJAMB backend is running', timestamp: new Date().toISOString() });
});

app.use('/api/admin',     adminRoutes);
app.use('/api/auth',      authRoutes);
app.use('/api/subjects',  subjectRoutes);
app.use('/api/questions', questionRoutes);
app.use('/api/quiz',      quizRoutes);
app.use('/api/past-exams', pastExamRoutes);
app.use('/api/leaderboard', leaderboardRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/bookmarks', bookmarkRoutes);
app.use('/api/auth/login',    authLimiter);
app.use('/api/auth/register', authLimiter);

// Security headers
app.use(helmet());

// Global rate limit — 100 requests per 15 minutes
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max:      100,
  message:  { error: 'Too many requests. Please slow down.' },
});
app.use(globalLimiter);

// ── Error handlers ───────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

app.use((err, _req, res, _next) => {
  console.error('[server error]', err.stack);
  res.status(500).json({ error: 'Something went wrong on the server' });
});

// ── Start ────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🚀 CrackJAMB backend running on http://localhost:${PORT}`);
});
