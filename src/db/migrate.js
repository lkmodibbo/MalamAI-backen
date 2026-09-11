const bcrypt = require('bcryptjs');
const pool = require('../config/database');

// Base schema. Every table the API touches is defined here so a brand new
// database can be brought up with `npm start` alone. Ordered so that a table
// is always created before anything that references it.
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
     id SERIAL PRIMARY KEY,
     name TEXT NOT NULL,
     email TEXT NOT NULL UNIQUE,
     password TEXT NOT NULL,
     is_verified BOOLEAN NOT NULL DEFAULT FALSE,
     is_admin BOOLEAN NOT NULL DEFAULT FALSE,
     verify_token TEXT,
     verify_token_expires TIMESTAMPTZ,
     reset_token TEXT,
     reset_token_expires TIMESTAMPTZ,
     exam_date DATE,
     selected_subjects TEXT,
     avatar_uri TEXT,
     onboarding_complete BOOLEAN NOT NULL DEFAULT FALSE,
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,

  `CREATE TABLE IF NOT EXISTS subjects (
     id TEXT PRIMARY KEY,
     name TEXT NOT NULL
   )`,

  `CREATE TABLE IF NOT EXISTS topics (
     id SERIAL PRIMARY KEY,
     subject_id TEXT REFERENCES subjects (id) ON DELETE CASCADE,
     name TEXT NOT NULL
   )`,

  `CREATE TABLE IF NOT EXISTS questions (
     id SERIAL PRIMARY KEY,
     subject_id TEXT REFERENCES subjects (id) ON DELETE CASCADE,
     topic_id INTEGER REFERENCES topics (id) ON DELETE SET NULL,
     question TEXT NOT NULL,
     option_a TEXT NOT NULL DEFAULT '',
     option_b TEXT NOT NULL DEFAULT '',
     option_c TEXT NOT NULL DEFAULT '',
     option_d TEXT NOT NULL DEFAULT '',
     answer TEXT NOT NULL,
     explanation TEXT,
     year INTEGER,
     is_ai BOOLEAN NOT NULL DEFAULT FALSE,
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,

  `CREATE TABLE IF NOT EXISTS past_questions (
     id SERIAL PRIMARY KEY,
     subject_id TEXT NOT NULL,
     year INTEGER NOT NULL,
     question TEXT NOT NULL,
     option_a TEXT NOT NULL,
     option_b TEXT NOT NULL,
     option_c TEXT NOT NULL,
     option_d TEXT NOT NULL,
     answer TEXT NOT NULL,
     explanation TEXT
   )`,

    `CREATE TABLE IF NOT EXISTS quiz_attempts (
      id SERIAL PRIMARY KEY,
      user_id __USER_ID_TYPE__ NOT NULL REFERENCES users (id) ON DELETE CASCADE,
     subject_id TEXT,
     topic_id INTEGER,
     topic_name TEXT,
     score INTEGER NOT NULL DEFAULT 0,
     total INTEGER NOT NULL DEFAULT 0,
     time_taken INTEGER NOT NULL DEFAULT 0,
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,

  `CREATE TABLE IF NOT EXISTS quiz_answers (
     id SERIAL PRIMARY KEY,
     attempt_id INTEGER NOT NULL REFERENCES quiz_attempts (id) ON DELETE CASCADE,
     question_id INTEGER,
     selected TEXT,
     is_correct BOOLEAN NOT NULL DEFAULT FALSE,
     time_spent INTEGER NOT NULL DEFAULT 0,
     question_text TEXT,
     correct_answer TEXT
   )`,

    `CREATE TABLE IF NOT EXISTS streaks (
      user_id __USER_ID_TYPE__ PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
     current_streak INTEGER NOT NULL DEFAULT 0,
     longest_streak INTEGER NOT NULL DEFAULT 0,
     last_active DATE
   )`,

    `CREATE TABLE IF NOT EXISTS notifications (
      id SERIAL PRIMARY KEY,
      user_id __USER_ID_TYPE__ NOT NULL REFERENCES users (id) ON DELETE CASCADE,
     title TEXT NOT NULL,
     message TEXT,
     type TEXT,
     is_read BOOLEAN NOT NULL DEFAULT FALSE,
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,

    `CREATE TABLE IF NOT EXISTS admin_audit (
      id SERIAL PRIMARY KEY,
      admin_id __USER_ID_TYPE__ REFERENCES users (id) ON DELETE SET NULL,
     action TEXT NOT NULL,
     resource_type TEXT,
     resource_id TEXT,
     details JSONB,
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,

    `CREATE TABLE IF NOT EXISTS bookmarks (
      id SERIAL PRIMARY KEY,
      user_id __USER_ID_TYPE__ NOT NULL REFERENCES users (id) ON DELETE CASCADE,
     question_id INTEGER NOT NULL,
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     UNIQUE (user_id, question_id)
   )`,

  `CREATE TABLE IF NOT EXISTS notes (
     id SERIAL PRIMARY KEY,
     user_id TEXT NOT NULL,
     subject_id TEXT,
     subject_name TEXT,
     topic TEXT NOT NULL,
     note TEXT,
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     UNIQUE (user_id, subject_id, topic)
   )`,

  `CREATE TABLE IF NOT EXISTS mock_exam_attempts (
     id SERIAL PRIMARY KEY,
     user_id TEXT NOT NULL,
     subject_ids TEXT,
     subject_scores JSONB,
     total_score INTEGER,
     total_possible INTEGER,
     predicted_score INTEGER,
     time_taken INTEGER DEFAULT 0,
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,

  `CREATE TABLE IF NOT EXISTS past_exam_attempts (
     id SERIAL PRIMARY KEY,
     user_id TEXT NOT NULL,
     subject_id TEXT,
     year INTEGER,
     score INTEGER,
     total INTEGER,
     time_taken INTEGER DEFAULT 0,
     completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,

  `CREATE TABLE IF NOT EXISTS past_exam_answers (
     id SERIAL PRIMARY KEY,
     attempt_id INTEGER NOT NULL REFERENCES past_exam_attempts (id) ON DELETE CASCADE,
     question_id INTEGER,
     selected TEXT,
     is_correct BOOLEAN NOT NULL DEFAULT FALSE
   )`,

  // Tracks per-user AI call counts per day to enforce rate limits
  `CREATE TABLE IF NOT EXISTS ai_usage (
     id SERIAL PRIMARY KEY,
     user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
     usage_date DATE NOT NULL DEFAULT CURRENT_DATE,
     chat_count INTEGER NOT NULL DEFAULT 0,
     generate_count INTEGER NOT NULL DEFAULT 0,
     UNIQUE (user_id, usage_date)
   )`,

  // Caches AI responses for deterministic prompts (explanations, flashcards, etc.)
  // so repeated requests for the same topic don't burn API quota.
  `CREATE TABLE IF NOT EXISTS ai_cache (
     id SERIAL PRIMARY KEY,
     prompt_hash TEXT NOT NULL UNIQUE,
     response TEXT NOT NULL,
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,

  // Persists named chat conversations so students can resume across devices.
  `CREATE TABLE IF NOT EXISTS ai_conversations (
     id SERIAL PRIMARY KEY,
     user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
     title TEXT NOT NULL DEFAULT 'New Chat',
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,

  // Individual messages within a conversation.
  `CREATE TABLE IF NOT EXISTS ai_messages (
     id SERIAL PRIMARY KEY,
     conversation_id INTEGER NOT NULL REFERENCES ai_conversations (id) ON DELETE CASCADE,
     role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
     content TEXT NOT NULL,
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,
];

// Brings databases created before the schema above was complete up to date.
// Each statement is a no-op on a database created from SCHEMA.
const BACKFILL = [
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS exam_date DATE`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS selected_subjects TEXT`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_uri TEXT`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarding_complete BOOLEAN DEFAULT FALSE`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT FALSE`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS verify_token TEXT`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS verify_token_expires TIMESTAMPTZ`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token TEXT`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token_expires TIMESTAMPTZ`,

  `ALTER TABLE topics ADD COLUMN IF NOT EXISTS subject_id TEXT`,

  `ALTER TABLE questions ADD COLUMN IF NOT EXISTS year INTEGER`,
  `ALTER TABLE questions ADD COLUMN IF NOT EXISTS is_ai BOOLEAN DEFAULT FALSE`,
  `ALTER TABLE questions ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`,
  `ALTER TABLE questions ADD COLUMN IF NOT EXISTS is_ai_reviewed BOOLEAN DEFAULT FALSE`,

  `ALTER TABLE quiz_attempts ADD COLUMN IF NOT EXISTS topic_name TEXT`,
  `ALTER TABLE quiz_attempts ADD COLUMN IF NOT EXISTS time_taken INTEGER DEFAULT 0`,

  `ALTER TABLE quiz_answers ADD COLUMN IF NOT EXISTS question_text TEXT`,
  `ALTER TABLE quiz_answers ADD COLUMN IF NOT EXISTS correct_answer TEXT`,
  `ALTER TABLE quiz_answers ALTER COLUMN question_id DROP NOT NULL`,

  `ALTER TABLE past_questions ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`,

  `ALTER TABLE streaks ADD COLUMN IF NOT EXISTS current_streak INTEGER DEFAULT 0`,
  `ALTER TABLE streaks ADD COLUMN IF NOT EXISTS longest_streak INTEGER DEFAULT 0`,
  `ALTER TABLE streaks ADD COLUMN IF NOT EXISTS last_active DATE`,

  `ALTER TABLE notifications ADD COLUMN IF NOT EXISTS is_read BOOLEAN DEFAULT FALSE`,
  `ALTER TABLE notifications ADD COLUMN IF NOT EXISTS type TEXT`,

  // The UI no longer renders subject emoji. The legacy columns are left in
  // place on existing databases but must be nullable now that nothing writes
  // to them. Fresh databases never have them, hence the guards.
  `DO $$ BEGIN
     IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_name = 'subjects' AND column_name = 'emoji') THEN
       ALTER TABLE subjects ALTER COLUMN emoji DROP NOT NULL;
     END IF;
   END $$`,
  `DO $$ BEGIN
     IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_name = 'notes' AND column_name = 'subject_emoji') THEN
       ALTER TABLE notes ALTER COLUMN subject_emoji DROP NOT NULL;
     END IF;
   END $$`,
];

const INDEXES = [
  `CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_idx ON users (LOWER(email))`,
  `CREATE INDEX IF NOT EXISTS users_verify_token_idx ON users (verify_token)`,
  `CREATE INDEX IF NOT EXISTS users_reset_token_idx ON users (reset_token)`,
  `CREATE INDEX IF NOT EXISTS topics_subject_idx ON topics (subject_id)`,
  `CREATE INDEX IF NOT EXISTS questions_subject_topic_idx ON questions (subject_id, topic_id)`,
  `CREATE INDEX IF NOT EXISTS past_questions_subject_year_idx ON past_questions (subject_id, year)`,
  `CREATE INDEX IF NOT EXISTS quiz_attempts_user_idx ON quiz_attempts (user_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS quiz_answers_attempt_idx ON quiz_answers (attempt_id)`,
  `CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications (user_id, created_at DESC)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS bookmarks_user_question ON bookmarks (user_id, question_id)`,
  `CREATE INDEX IF NOT EXISTS notes_user_idx ON notes (user_id, updated_at DESC)`,
  `CREATE INDEX IF NOT EXISTS mock_exam_attempts_user_idx ON mock_exam_attempts (user_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS past_exam_attempts_user_idx ON past_exam_attempts (user_id, completed_at DESC)`,
  `CREATE INDEX IF NOT EXISTS past_exam_answers_attempt_idx ON past_exam_answers (attempt_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS ai_usage_user_date_idx ON ai_usage (user_id, usage_date)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS ai_cache_hash_idx ON ai_cache (prompt_hash)`,
  `CREATE INDEX IF NOT EXISTS ai_conversations_user_idx ON ai_conversations (user_id, updated_at DESC)`,
  `CREATE INDEX IF NOT EXISTS ai_messages_conversation_idx ON ai_messages (conversation_id, created_at ASC)`,
];

async function migrate() {
  // Determine the type used for users.id on the target database. Some
  // existing installations use UUID for users.id while the current schema
  // defaults to SERIAL (integer). To avoid foreign key type mismatches we
  // adapt any user-id columns to match the actual type in the database.
  let userIdType = 'INTEGER';
  try {
    const res = await pool.query("SELECT udt_name FROM information_schema.columns WHERE table_name='users' AND column_name='id'");
    if (res.rows.length > 0 && res.rows[0].udt_name === 'uuid') {
      userIdType = 'UUID';
    }
  } catch (err) {
    // if the query fails, default to INTEGER — the SCHEMA create is written
    // to be harmless on fresh DBs.
  }

  // Prepare statements, substituting the placeholder with the detected type
  const statements = SCHEMA.map((s) => s.replace(/__USER_ID_TYPE__/g, userIdType));

  // The base schema must succeed — without it nothing else can work.
  for (const sql of statements) {
    await pool.query(sql);
  }

  // Backfills and indexes only matter for databases that predate the schema
  // above, so a failure here should not stop the server from booting.
  for (const sql of [...BACKFILL, ...INDEXES]) {
    try {
      await pool.query(sql);
    } catch (err) {
      console.warn('[migrate] skipped statement:', err.message);
    }
  }

  await seedSubjects();
  await seedAdmin();
  console.log('[migrate] schema is up to date');
}

async function seedSubjects() {
  const subjects = [
    ['english', 'Use of English'],
    ['mathematics', 'Mathematics'],
    ['physics', 'Physics'],
    ['chemistry', 'Chemistry'],
    ['biology', 'Biology'],
    ['economics', 'Economics'],
    ['government', 'Government'],
    ['literature', 'Literature in English'],
    ['geography', 'Geography'],
    ['agriculture', 'Agricultural Science'],
    ['commerce', 'Commerce'],
    ['accounting', 'Financial Accounting'],
    ['civic', 'Civic Education'],
    ['crk', 'Christian Religious Studies'],
    ['irk', 'Islamic Studies'],
    ['further_maths', 'Further Mathematics'],
    ['technical_drawing', 'Technical Drawing'],
  ];
  try {
    for (const [id, name] of subjects) {
      await pool.query(
        `INSERT INTO subjects (id, name)
         VALUES ($1, $2)
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`,
        [id, name]
      );
    }
  } catch (err) {
    console.warn('[migrate] subject seed skipped:', err.message);
  }
}

async function seedAdmin() {
  const isProd = process.env.NODE_ENV === 'production';
  const email = process.env.ADMIN_EMAIL
    ? String(process.env.ADMIN_EMAIL).toLowerCase()
    : (isProd ? null : 'admin@crackjamb.local');
  const password = process.env.ADMIN_PASSWORD || (isProd ? null : 'Admin12345');
  const name = process.env.ADMIN_NAME || 'CrackJAMB Admin';

  if (!email || !password) {
    if (isProd) {
      console.error('[migrate] ADMIN_EMAIL and ADMIN_PASSWORD are required to seed an admin in production.');
    }
    return;
  }

  if (isProd && (password.length < 12 || password === 'Admin12345')) {
    console.error('[migrate] Refusing to seed a weak ADMIN_PASSWORD in production.');
    return;
  }

  try {
    const existing = await pool.query(
      'SELECT id, is_admin FROM users WHERE email = $1',
      [email]
    );

    if (existing.rows.length > 0) {
      if (!existing.rows[0].is_admin) {
        await pool.query(
          'UPDATE users SET is_admin = TRUE, is_verified = TRUE WHERE id = $1',
          [existing.rows[0].id]
        );
      }
      return;
    }

    const anyAdmin = await pool.query(
      'SELECT id FROM users WHERE is_admin = TRUE LIMIT 1'
    );
    if (anyAdmin.rows.length > 0 && !process.env.ADMIN_EMAIL) {
      return;
    }

    const hash = await bcrypt.hash(password, 10);
    await pool.query(
      `INSERT INTO users (name, email, password, is_verified, is_admin, onboarding_complete)
       VALUES ($1, $2, $3, TRUE, TRUE, TRUE)`,
      [name, email, hash]
    );
    console.log(`[migrate] Admin account ready: ${email}`);
  } catch (err) {
    console.warn('[migrate] admin seed skipped:', err.message);
  }
}

module.exports = migrate;
