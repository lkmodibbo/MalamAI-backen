const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const adminOnly = require('../middleware/adminOnly');
const MAX_BULK_ITEMS = 200;

function validateQuestionPayload(q) {
  if (!q || typeof q !== 'object') return 'Invalid question object';
  const fields = ['subject_id', 'question', 'option_a', 'option_b', 'option_c', 'option_d', 'answer'];
  for (const f of fields) {
    if (!q[f] || String(q[f]).trim().length === 0) return `${f} is required`;
  }
  if (!['A', 'B', 'C', 'D'].includes(String(q.answer).toUpperCase())) return 'Answer must be A, B, C or D';
  if (String(q.question).length > 4000) return 'Question too long';
  for (const opt of ['option_a', 'option_b', 'option_c', 'option_d']) {
    if (String(q[opt]).length > 1000) return `${opt} too long`;
  }
  if (q.year && (Number(q.year) < 1900 || Number(q.year) > 2100)) return 'Invalid year';
  return null;
}

function validatePastQuestionPayload(q) {
  const err = validateQuestionPayload(q);
  if (err) return err;
  if (!q.year) return 'year is required';
  return null;
}

function parseSubjects(raw) {
  try {
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function logAudit(adminId, action, resourceType = null, resourceId = null, details = null) {
  try {
    await pool.query(
      `INSERT INTO admin_audit (admin_id, action, resource_type, resource_id, details)
       VALUES ($1,$2,$3,$4,$5)`,
      [adminId || null, action, resourceType, resourceId, details ? JSON.stringify(details) : null]
    );
  } catch (err) {
    console.warn('[audit] failed to record audit entry:', err.message);
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ADD A NEW SUBJECT
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.post('/subjects', adminOnly, async (req, res) => {
  const { id, name } = req.body;

  if (!id || !name) {
    return res.status(400).json({ error: 'id and name are required.' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO subjects (id, name)
       VALUES ($1, $2)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name
       RETURNING *`,
      [id.toLowerCase(), name]
    );
    res.status(201).json({
      message: 'Subject added successfully',
      subject: result.rows[0],
    });
  } catch (err) {
    console.error('[admin] add subject failed:', err);
    res.status(500).json({ error: 'Could not add subject.' });
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ADD MULTIPLE SUBJECTS AT ONCE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.post('/subjects/bulk', adminOnly, async (req, res) => {
  const { subjects } = req.body;

  if (!Array.isArray(subjects) || subjects.length === 0) {
    return res.status(400).json({ error: 'subjects array is required.' });
  }

  if (subjects.length > MAX_BULK_ITEMS) {
    return res.status(400).json({ error: `Too many subjects; max ${MAX_BULK_ITEMS} per request.` });
  }

  try {
    const added = [];
    const errors = [];
    for (const [i, s] of subjects.entries()) {
      if (!s || !s.id || !s.name) {
        errors.push({ index: i, error: 'id and name are required' });
        continue;
      }
      if (String(s.id).length > 64 || String(s.name).length > 255) {
        errors.push({ index: i, id: s.id || null, error: 'id or name too long' });
        continue;
      }
      try {
        const result = await pool.query(
          `INSERT INTO subjects (id, name)
           VALUES ($1, $2)
           ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name
           RETURNING *`,
          [String(s.id).toLowerCase(), s.name]
        );
        added.push(result.rows[0]);
          try { await logAudit(req.user?.id || null, 'bulk_add_subject', 'subject', result.rows[0].id, { id: result.rows[0].id, name: result.rows[0].name }); } catch (e) {}
      } catch (err) {
        errors.push({ index: i, id: s.id || null, error: err.message });
      }
    }
    res.status(201).json({
      message: `${added.length} subjects added successfully`,
      subjects: added,
      errors,
    });
  } catch (err) {
    console.error('[admin] bulk add subjects failed:', err);
    res.status(500).json({ error: 'Could not add subjects.' });
  }
});

// Topics have no unique constraint, so re-adding one would silently create a
// duplicate that then splits a subject's questions across two topic ids.
async function upsertTopic(subjectId, name) {
  const subject = String(subjectId).toLowerCase();
  const trimmed = String(name).trim();

  const existing = await pool.query(
    `SELECT * FROM topics WHERE subject_id = $1 AND LOWER(name) = LOWER($2) LIMIT 1`,
    [subject, trimmed]
  );
  if (existing.rows.length > 0) return existing.rows[0];

    const result = await pool.query(
    `INSERT INTO topics (subject_id, name) VALUES ($1, $2) RETURNING *`,
    [subject, trimmed]
  );
  return created.rows[0];
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ADD A NEW TOPIC
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.post('/topics', adminOnly, async (req, res) => {
  const { subject_id, name } = req.body;

  if (!subject_id || !name) {
    return res.status(400).json({ error: 'subject_id and name are required.' });
  }
    try { await logAudit(req.user?.id || null, 'add_question', 'question', result.rows[0].id, { subject_id: result.rows[0].subject_id }); } catch (e) {}

  try {
    const topic = await upsertTopic(subject_id, name);
    res.status(201).json({
      message: 'Topic added successfully',
      topic,
    });
    try { await logAudit(req.user?.id || null, 'add_topic', 'topic', topic.id, { subject_id: topic.subject_id, name: topic.name }); } catch (e) {}
  } catch (err) {
    console.error('[admin] add topic failed:', err);
    res.status(500).json({ error: 'Could not add topic.' });
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ADD MULTIPLE TOPICS AT ONCE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.post('/topics/bulk', adminOnly, async (req, res) => {
  const { topics } = req.body;

  if (!Array.isArray(topics) || topics.length === 0) {
    return res.status(400).json({ error: 'topics array is required.' });
  }

  if (topics.length > MAX_BULK_ITEMS) {
    return res.status(400).json({ error: `Too many topics; max ${MAX_BULK_ITEMS} per request.` });
  }

  try {
    const added = [];
    const errors = [];
    for (const [i, t] of topics.entries()) {
      if (!t || !t.subject_id || !t.name) {
        errors.push({ index: i, error: 'subject_id and name are required' });
        continue;
      }
      if (String(t.name).length > 255) {
        errors.push({ index: i, error: 'name too long' });
        continue;
      }
      try {
        added.push(await upsertTopic(t.subject_id, t.name));
      } catch (err) {
        errors.push({ index: i, error: err.message });
      }
    }
    res.status(201).json({
      message: `${added.length} topics added successfully`,
      topics: added,
      errors,
    });
  } catch (err) {
    console.error('[admin] bulk add topics failed:', err);
    res.status(500).json({ error: 'Could not add topics.' });
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// DELETE A SUBJECT
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.delete('/subjects/:id', adminOnly, async (req, res) => {
  try {
    await pool.query('DELETE FROM subjects WHERE id = $1', [req.params.id]);
    res.json({ message: 'Subject deleted successfully' });
  } catch (err) {
    console.error('[admin] delete subject failed:', err);
    res.status(500).json({ error: 'Could not delete subject.' });
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// DELETE A TOPIC
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.delete('/topics/:id', adminOnly, async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM topics WHERE id = $1 RETURNING id', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Topic not found.' });
    await logAudit(req.user?.id || null, 'delete_topic', 'topic', req.params.id, null);
    res.json({ message: 'Topic deleted successfully' });
  } catch (err) {
    console.error('[admin] delete topic failed:', err);
    res.status(500).json({ error: 'Could not delete topic.' });
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GET ALL SUBJECTS WITH TOPIC COUNT
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.get('/topics', adminOnly, async (req, res) => {
  const subject = String(req.query.subject || '').trim();
  try {
    const params = [];
    let where = '';
    if (subject) {
      where = 'WHERE t.subject_id = $1';
      params.push(subject);
    }
    const result = await pool.query(
      `SELECT t.id, t.subject_id, t.name, s.name AS subject_name
       FROM topics t
       LEFT JOIN subjects s ON s.id = t.subject_id
       ${where}
       ORDER BY s.name, t.name`,
      params
    );
    res.json({ topics: result.rows });
  } catch (err) {
    console.error('[admin] list topics:', err);
    res.status(500).json({ error: 'Could not fetch topics.' });
  }
});

router.get('/overview', adminOnly, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT s.id, s.name, COUNT(t.id) AS topic_count
       FROM subjects s
       LEFT JOIN topics t ON t.subject_id = s.id
       GROUP BY s.id, s.name
       ORDER BY s.name`
    );
    res.json({ subjects: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Could not fetch overview.' });
  }
});
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ADD A SINGLE QUESTION
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.post('/questions', adminOnly, async (req, res) => {
  const {
    subject_id, topic_id, question,
    option_a, option_b, option_c, option_d,
    answer, explanation, year,
  } = req.body;

  if (!subject_id || !question || !option_a || !option_b ||
      !option_c || !option_d || !answer) {
    return res.status(400).json({ error: 'All question fields are required.' });
  }

  if (!['A', 'B', 'C', 'D'].includes(answer.toUpperCase())) {
    return res.status(400).json({ error: 'Answer must be A, B, C or D.' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO questions
         (subject_id, topic_id, question, option_a, option_b,
          option_c, option_d, answer, explanation, year, is_ai)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, FALSE)
       RETURNING *`,
      [subject_id, topic_id || null, question,
       option_a, option_b, option_c, option_d,
       answer.toUpperCase(), explanation || null, year || null]
    );
    res.status(201).json({
      message:  'Question added successfully',
      question: result.rows[0],
    });
  } catch (err) {
    console.error('[admin] add question:', err);
    res.status(500).json({ error: 'Could not add question.' });
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// BULK UPLOAD QUESTIONS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.post('/questions/bulk', adminOnly, async (req, res) => {
  const { questions } = req.body;

  if (!Array.isArray(questions) || questions.length === 0) {
    return res.status(400).json({ error: 'questions array is required.' });
  }

  if (questions.length > MAX_BULK_ITEMS) {
    return res.status(400).json({ error: `Too many questions; max ${MAX_BULK_ITEMS} per request.` });
  }

  try {
    const added  = [];
    const errors = [];

    for (const [i, q] of questions.entries()) {
      const v = validateQuestionPayload(q);
      if (v) {
        errors.push({ index: i, question: q.question || null, error: v });
        continue;
      }
      try {
          const result = await pool.query(
          `INSERT INTO questions
             (subject_id, topic_id, question, option_a, option_b,
              option_c, option_d, answer, explanation, year, is_ai)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, FALSE)
           RETURNING id, question`,
          [String(q.subject_id).toLowerCase(), q.topic_id || null, q.question,
           q.option_a, q.option_b, q.option_c, q.option_d,
           String(q.answer).toUpperCase(), q.explanation || null, q.year || null]
        );
        added.push(result.rows[0]);
          try { await logAudit(req.user?.id || null, 'bulk_add_question', 'question', result.rows[0].id, { index: i }); } catch (e) {}
      } catch (err) {
        errors.push({ index: i, question: q.question, error: err.message });
      }
    }

    res.status(201).json({
      message: `${added.length} questions added. ${errors.length} failed.`,
      added,
      errors,
    });
  } catch (err) {
    console.error('[admin] bulk questions:', err);
    res.status(500).json({ error: 'Could not upload questions.' });
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// DELETE A QUESTION
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.delete('/questions/:id', adminOnly, async (req, res) => {
  try {
    const result = await pool.query('UPDATE questions SET deleted_at = NOW() WHERE id = $1 RETURNING id', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Question not found.' });
    await logAudit(req.user?.id || null, 'soft_delete_question', 'question', req.params.id, null);
    res.json({ message: 'Question soft-deleted.' });
  } catch (err) {
    res.status(500).json({ error: 'Could not delete question.' });
  }
});

router.post('/questions/:id/restore', adminOnly, async (req, res) => {
  try {
    const result = await pool.query('UPDATE questions SET deleted_at = NULL WHERE id = $1 RETURNING id', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Question not found.' });
    await logAudit(req.user?.id || null, 'restore_question', 'question', req.params.id, null);
    res.json({ message: 'Question restored.' });
  } catch (err) {
    res.status(500).json({ error: 'Could not restore question.' });
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GET ALL QUESTIONS (with filters)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.get('/questions', adminOnly, async (req, res) => {
  const { subject, topic, year, page = 1, limit = 20, deleted } = req.query;
  const offset = (page - 1) * limit;

  try {
    let query  = `
      SELECT q.*, s.name as subject_name, t.name as topic_name
      FROM questions q
      LEFT JOIN subjects s ON q.subject_id = s.id
      LEFT JOIN topics   t ON q.topic_id   = t.id
      WHERE 1=1
    `;
    const params = [];
    let   count  = 1;

    if (subject) { query += ` AND q.subject_id = $${count++}`; params.push(subject); }
    if (topic)   { query += ` AND q.topic_id   = $${count++}`; params.push(topic);   }
    if (year)    { query += ` AND q.year        = $${count++}`; params.push(year);    }
    if (deleted === '1' || deleted === 'true') { query += ` AND q.deleted_at IS NOT NULL`; }
    else { query += ` AND q.deleted_at IS NULL`; }

    query += ` ORDER BY q.created_at DESC LIMIT $${count++} OFFSET $${count}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);
    res.json({ questions: result.rows, page: Number(page), limit: Number(limit) });
  } catch (err) {
    console.error('[admin] get questions:', err);
    res.status(500).json({ error: 'Could not fetch questions.' });
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// BULK UPLOAD PAST QUESTIONS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.post('/past-questions/bulk', adminOnly, async (req, res) => {
  const { questions } = req.body;

  if (!Array.isArray(questions) || questions.length === 0) {
    return res.status(400).json({ error: 'questions array is required.' });
  }

  if (questions.length > MAX_BULK_ITEMS) {
    return res.status(400).json({ error: `Too many questions; max ${MAX_BULK_ITEMS} per request.` });
  }

  const added  = [];
  const errors = [];

  for (const [i, q] of questions.entries()) {
    const v = validatePastQuestionPayload(q);
    if (v) {
      errors.push({ index: i, error: v });
      continue;
    }
    try {
      const result = await pool.query(
        `INSERT INTO past_questions
           (subject_id, year, question, option_a, option_b, option_c, option_d, answer, explanation)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING id`,
        [String(q.subject_id).toLowerCase(), parseInt(q.year), q.question,
         q.option_a, q.option_b, q.option_c, q.option_d,
         String(q.answer).toUpperCase(), q.explanation || null]
      );
      added.push(result.rows[0].id);
    } catch (err) {
      errors.push({ index: i, error: err.message });
    }
  }

  res.status(201).json({
    message: `${added.length} past questions added. ${errors.length} failed.`,
    added_count: added.length,
    errors,
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GET PAST QUESTIONS OVERVIEW (admin)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.get('/past-questions/overview', adminOnly, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT subject_id, year, COUNT(*) AS count
       FROM past_questions
       GROUP BY subject_id, year
       ORDER BY subject_id, year DESC`
    );
    res.json({ overview: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Could not fetch overview.' });
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ADMIN DASHBOARD STATS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.get('/dashboard', adminOnly, async (req, res) => {
  try {
    const [users, questions, attempts, pastQ] = await Promise.all([
      pool.query('SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE is_verified) AS verified FROM users'),
      pool.query('SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE is_ai) AS ai_generated FROM questions'),
      pool.query('SELECT COUNT(*) AS total, ROUND(AVG(score::decimal/total*100),1) AS avg_score FROM quiz_attempts'),
      pool.query('SELECT COUNT(*) AS total FROM past_questions'),
    ]);

    res.json({
      users: {
        total:    parseInt(users.rows[0].total),
        verified: parseInt(users.rows[0].verified),
      },
      questions: {
        total:        parseInt(questions.rows[0].total),
        ai_generated: parseInt(questions.rows[0].ai_generated),
        past_jamb:    parseInt(pastQ.rows[0].total),
      },
      quiz_attempts: {
        total:         parseInt(attempts.rows[0].total),
        average_score: parseFloat(attempts.rows[0].avg_score),
      },
    });
  } catch (err) {
    console.error('[admin dashboard]', err);
    res.status(500).json({ error: 'Could not fetch dashboard stats.' });
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GET ALL USERS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.get('/users', adminOnly, async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
  const offset = (page - 1) * limit;
  const search = String(req.query.q || '').trim();
  const like = search ? `%${search}%` : null;

  try {
    const countResult = await pool.query(
      `SELECT COUNT(*) AS total
       FROM users
       WHERE ($1::text IS NULL OR name ILIKE $1 OR email ILIKE $1)`,
      [like]
    );

    const result = await pool.query(
      `SELECT
         u.id, u.name, u.email, u.is_verified, u.is_admin, u.created_at,
         u.exam_date, u.selected_subjects, u.onboarding_complete,
         COUNT(qa.id) AS quiz_count
       FROM users u
       LEFT JOIN quiz_attempts qa ON qa.user_id = u.id
       WHERE ($3::text IS NULL OR u.name ILIKE $3 OR u.email ILIKE $3)
       GROUP BY u.id
       ORDER BY u.created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset, like]
    );

    const users = result.rows.map((row) => ({
      ...row,
      quiz_count: parseInt(row.quiz_count, 10) || 0,
      selected_subjects: parseSubjects(row.selected_subjects),
    }));

    res.json({
      users,
      page,
      limit,
      total: parseInt(countResult.rows[0].total, 10) || 0,
    });
  } catch (err) {
    console.error('[admin] get users:', err);
    res.status(500).json({ error: 'Could not fetch users.' });
  }
});

router.get('/users/:id', adminOnly, async (req, res) => {
  const userId = String(req.params.id || '').trim();
  if (!userId) {
    return res.status(400).json({ error: 'Invalid user id.' });
  }

  try {
    const userResult = await pool.query(
      `SELECT id, name, email, is_verified, is_admin, created_at,
              exam_date, selected_subjects, avatar_uri, onboarding_complete
       FROM users WHERE id = $1`,
      [userId]
    );
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const user = userResult.rows[0];
    const selectedIds = parseSubjects(user.selected_subjects);

    const settled = await Promise.allSettled([
      selectedIds.length
        ? pool.query(
            `SELECT id, name FROM subjects WHERE id = ANY($1::text[])`,
            [selectedIds]
          )
        : Promise.resolve({ rows: [] }),
      pool.query(
        `SELECT
           COUNT(*) AS total_quizzes,
           COALESCE(ROUND(AVG(score::decimal / NULLIF(total, 0) * 100), 1), 0) AS average_score,
           COALESCE(SUM(score), 0) AS total_correct,
           COALESCE(SUM(total), 0) AS total_questions
         FROM quiz_attempts WHERE user_id = $1`,
        [userId]
      ),
      pool.query(
        `SELECT
           COUNT(*) AS total_attempts,
           COALESCE(ROUND(AVG(score::decimal / NULLIF(total, 0) * 100), 1), 0) AS average_score
         FROM past_exam_attempts WHERE user_id = $1`,
        [userId]
      ),
      pool.query(
        `SELECT current_streak, longest_streak, last_active
         FROM streaks WHERE user_id = $1`,
        [userId]
      ),
      pool.query(
        `SELECT id, subject_id, topic_name, score, total, time_taken, created_at
         FROM quiz_attempts WHERE user_id = $1
         ORDER BY created_at DESC LIMIT 8`,
        [userId]
      ),
      pool.query(
        `SELECT id, subject_id, year, score, total, time_taken, completed_at
         FROM past_exam_attempts WHERE user_id = $1
         ORDER BY completed_at DESC LIMIT 8`,
        [userId]
      ),
      pool.query(
        `SELECT COUNT(*) AS total, COALESCE(ROUND(AVG(predicted_score), 1), 0) AS avg_predicted
         FROM mock_exam_attempts WHERE user_id = $1`,
        [userId]
      ),
    ]);
    const pick = (index, fallback) => (
      settled[index].status === 'fulfilled' ? settled[index].value : fallback
    );
    const subjects = pick(0, { rows: [] });
    const quizStats = pick(1, { rows: [{ total_quizzes: 0, average_score: 0, total_correct: 0, total_questions: 0 }] });
    const pastStats = pick(2, { rows: [{ total_attempts: 0, average_score: 0 }] });
    const streak = pick(3, { rows: [] });
    const recentQuizzes = pick(4, { rows: [] });
    const recentPast = pick(5, { rows: [] });
    const mockStats = pick(6, { rows: [{ total: 0, avg_predicted: 0 }] });

    const subjectMap = new Map(subjects.rows.map((s) => [s.id, s]));
    const enrolled = selectedIds.map((id) => subjectMap.get(id) || { id, name: id });

    res.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        is_verified: user.is_verified,
        is_admin: user.is_admin,
        created_at: user.created_at,
        exam_date: user.exam_date,
        avatar_uri: user.avatar_uri,
        onboarding_complete: user.onboarding_complete,
        selected_subjects: selectedIds,
      },
      enrolled,
      stats: {
        quizzes: {
          total: parseInt(quizStats.rows[0].total_quizzes, 10) || 0,
          average_score: parseFloat(quizStats.rows[0].average_score) || 0,
          total_correct: parseInt(quizStats.rows[0].total_correct, 10) || 0,
          total_questions: parseInt(quizStats.rows[0].total_questions, 10) || 0,
        },
        past_exams: {
          total: parseInt(pastStats.rows[0].total_attempts, 10) || 0,
          average_score: parseFloat(pastStats.rows[0].average_score) || 0,
        },
        mocks: {
          total: parseInt(mockStats.rows[0].total, 10) || 0,
          avg_predicted: parseFloat(mockStats.rows[0].avg_predicted) || 0,
        },
        streak: streak.rows[0] || { current_streak: 0, longest_streak: 0, last_active: null },
      },
      recent_quizzes: recentQuizzes.rows,
      recent_past_exams: recentPast.rows,
    });
  } catch (err) {
    console.error('[admin] get user detail:', err);
    res.status(500).json({ error: 'Could not fetch user details.' });
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SET USER ROLE (PROMOTE / DEMOTE)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.post('/users/:id/role', adminOnly, async (req, res) => {
  const userId = String(req.params.id || '').trim();
  if (!userId) return res.status(400).json({ error: 'Invalid user id.' });

  // Expect { is_admin: true|false }
  const isAdmin = !!req.body.is_admin;

  // Prevent an admin from demoting themselves via this endpoint
  if (req.user && String(req.user.id) === String(userId) && !isAdmin) {
    return res.status(400).json({ error: 'You cannot demote your own account.' });
  }

  try {
    // If demoting, ensure we don't remove the last admin
    if (!isAdmin) {
      const adminsRes = await pool.query('SELECT COUNT(*) AS total FROM users WHERE is_admin = TRUE');
      const adminCount = parseInt(adminsRes.rows[0].total, 10) || 0;
      // If the target user is currently an admin and there's only one admin, prevent demotion
      const targetRes = await pool.query('SELECT is_admin FROM users WHERE id = $1', [userId]);
      if (targetRes.rows.length === 0) return res.status(404).json({ error: 'User not found.' });
      if (targetRes.rows[0].is_admin && adminCount <= 1) {
        return res.status(400).json({ error: 'Cannot demote the last admin account.' });
      }
    }

    const result = await pool.query(
      `UPDATE users SET is_admin = $1 WHERE id = $2 RETURNING id, name, email, is_admin`,
      [isAdmin, userId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found.' });
    await logAudit(req.user?.id || null, isAdmin ? 'promote_user' : 'demote_user', 'user', userId, { is_admin: isAdmin });
    res.json({ user: result.rows[0] });
  } catch (err) {
    console.error('[admin] set user role:', err);
    res.status(500).json({ error: 'Could not update user role.' });
  }
});

router.get('/leaderboard', adminOnly, async (req, res) => {
  const subjectId = String(req.query.subject || '').trim();
  try {
    const params = [];
    let subjectFilter = '';
    if (subjectId) {
      params.push(subjectId);
      subjectFilter = `AND qa.subject_id = $1`;
    }

    const result = await pool.query(
      `SELECT
         u.id,
         u.name,
         u.email,
         COUNT(qa.id) AS total_quizzes,
         ROUND(AVG(qa.score::decimal / NULLIF(qa.total, 0) * 100), 1) AS average_score,
         SUM(qa.score) AS total_correct
       FROM quiz_attempts qa
       JOIN users u ON qa.user_id = u.id
       WHERE u.is_verified = TRUE
         AND qa.total > 0
         AND COALESCE(u.is_admin, FALSE) = FALSE
         ${subjectFilter}
       GROUP BY u.id, u.name, u.email
       HAVING COUNT(qa.id) >= 1
       ORDER BY average_score DESC, total_quizzes DESC
       LIMIT 50`,
      params
    );

    res.json({ leaderboard: result.rows, subject_id: subjectId || null });
  } catch (err) {
    console.error('[admin] leaderboard:', err);
    res.status(500).json({ error: 'Could not fetch leaderboard.' });
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GET ADMIN AUDIT LOGS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.get('/audit', adminOnly, async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
  const offset = (page - 1) * limit;
  const action = String(req.query.action || '').trim();
  const resource = String(req.query.resource || '').trim();

  try {
    const where = [];
    const params = [];
    let i = 1;
    if (action) { where.push(`a.action = $${i++}`); params.push(action); }
    if (resource) { where.push(`a.resource_type = $${i++}`); params.push(resource); }
    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const countRes = await pool.query(`SELECT COUNT(*) AS total FROM admin_audit a ${whereClause}`, params);
    const rowsRes = await pool.query(
      `SELECT a.id, a.admin_id, u.name AS admin_name, a.action, a.resource_type, a.resource_id, a.details, a.created_at
       FROM admin_audit a
       LEFT JOIN users u ON u.id = a.admin_id
       ${whereClause}
       ORDER BY a.created_at DESC
       LIMIT $${i++} OFFSET $${i}`,
      [...params, limit, offset]
    );

    res.json({
      logs: rowsRes.rows,
      page,
      limit,
      total: parseInt(countRes.rows[0].total, 10) || 0,
    });
  } catch (err) {
    console.error('[admin] audit list:', err);
    res.status(500).json({ error: 'Could not fetch audit logs.' });
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// EXPORT ADMIN AUDIT LOGS AS CSV
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.get('/audit/export', adminOnly, async (req, res) => {
  const action = String(req.query.action || '').trim();
  const resource = String(req.query.resource || '').trim();

  try {
    const where = [];
    const params = [];
    let i = 1;
    if (action) { where.push(`a.action = $${i++}`); params.push(action); }
    if (resource) { where.push(`a.resource_type = $${i++}`); params.push(resource); }
    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const rowsRes = await pool.query(
      `SELECT a.id, a.admin_id, u.name AS admin_name, a.action, a.resource_type, a.resource_id, a.details, a.created_at
       FROM admin_audit a
       LEFT JOIN users u ON u.id = a.admin_id
       ${whereClause}
       ORDER BY a.created_at DESC`,
      params
    );

    const escape = (v) => {
      if (v === null || v === undefined) return '';
      const s = typeof v === 'string' ? v : JSON.stringify(v);
      return `"${s.replace(/"/g, '""')}"`;
    };

    const header = ['id','admin_id','admin_name','action','resource_type','resource_id','details','created_at'];
    const lines = [header.join(',')];
    for (const row of rowsRes.rows) {
      lines.push([
        row.id,
        row.admin_id,
        row.admin_name,
        row.action,
        row.resource_type,
        row.resource_id,
        row.details ? JSON.stringify(row.details) : '',
        row.created_at ? row.created_at.toISOString() : '',
      ].map(escape).join(','));
    }

    const csv = lines.join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="admin_audit_${Date.now()}.csv"`);
    res.send(csv);
  } catch (err) {
    console.error('[admin] export audit:', err);
    res.status(500).json({ error: 'Could not export audit logs.' });
  }
});

router.get('/past-questions', adminOnly, async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
  const offset = (page - 1) * limit;
  const subject = String(req.query.subject || '').trim();
  const year = String(req.query.year || '').trim();
  const q = String(req.query.q || '').trim();
  const deleted = String(req.query.deleted || '').trim();

  try {
    const clauses = [];
    const params = [];
    let i = 1;
    if (subject) {
      clauses.push(`subject_id = $${i++}`);
      params.push(subject);
    }
    if (year) {
      clauses.push(`year = $${i++}`);
      params.push(parseInt(year, 10));
    }
    if (q) {
      clauses.push(`question ILIKE $${i++}`);
      params.push(`%${q}%`);
    }
    // default: only non-deleted items unless deleted=1
    if (deleted === '1' || deleted === 'true') {
      clauses.push(`deleted_at IS NOT NULL`);
    } else {
      clauses.push(`deleted_at IS NULL`);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

    const countResult = await pool.query(
      `SELECT COUNT(*) AS total FROM past_questions ${where}`,
      params
    );
    const result = await pool.query(
      `SELECT id, subject_id, year, question, option_a, option_b, option_c, option_d, answer, explanation
       FROM past_questions
       ${where}
       ORDER BY year DESC, id DESC
       LIMIT $${i++} OFFSET $${i}`,
      [...params, limit, offset]
    );

    res.json({
      questions: result.rows,
      page,
      limit,
      total: parseInt(countResult.rows[0].total, 10) || 0,
    });
  } catch (err) {
    console.error('[admin] list past questions:', err);
    res.status(500).json({ error: 'Could not fetch past questions.' });
  }
});

router.post('/past-questions', adminOnly, async (req, res) => {
  const {
    subject_id, year, question,
    option_a, option_b, option_c, option_d,
    answer, explanation,
  } = req.body || {};

  if (!subject_id || !year || !question || !option_a || !option_b || !option_c || !option_d || !answer) {
    return res.status(400).json({ error: 'All past question fields are required.' });
  }
  if (!['A', 'B', 'C', 'D'].includes(String(answer).toUpperCase())) {
    return res.status(400).json({ error: 'Answer must be A, B, C or D.' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO past_questions
         (subject_id, year, question, option_a, option_b, option_c, option_d, answer, explanation)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING *`,
      [
        String(subject_id).toLowerCase(),
        parseInt(year, 10),
        question,
        option_a, option_b, option_c, option_d,
        String(answer).toUpperCase(),
        explanation || null,
      ]
    );
    res.status(201).json({
      message: 'Past question added.',
      question: result.rows[0],
    });
    try { await logAudit(req.user?.id || null, 'add_past_question', 'past_question', result.rows[0].id, { subject_id: result.rows[0].subject_id }); } catch (e) {}
  } catch (err) {
    console.error('[admin] add past question:', err);
    res.status(500).json({ error: 'Could not add past question.' });
  }
});

router.delete('/past-questions/:id', adminOnly, async (req, res) => {
  try {
    const result = await pool.query('UPDATE past_questions SET deleted_at = NOW() WHERE id = $1 RETURNING id', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Past question not found.' });
    await logAudit(req.user?.id || null, 'soft_delete_past_question', 'past_question', req.params.id, null);
    res.json({ message: 'Past question soft-deleted.' });
  } catch (err) {
    console.error('[admin] delete past question:', err);
    res.status(500).json({ error: 'Could not delete past question.' });
  }
});

router.post('/past-questions/:id/restore', adminOnly, async (req, res) => {
  try {
    const result = await pool.query('UPDATE past_questions SET deleted_at = NULL WHERE id = $1 RETURNING id', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Past question not found.' });
    await logAudit(req.user?.id || null, 'restore_past_question', 'past_question', req.params.id, null);
    res.json({ message: 'Past question restored.' });
  } catch (err) {
    console.error('[admin] restore past question:', err);
    res.status(500).json({ error: 'Could not restore past question.' });
  }
});

router.delete('/past-questions/:id', adminOnly, async (req, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM past_questions WHERE id = $1 RETURNING id',
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Past question not found.' });
    }
    await logAudit(req.user?.id || null, 'delete_past_question', 'past_question', req.params.id, null);
    res.json({ message: 'Past question deleted.' });
  } catch (err) {
    console.error('[admin] delete past question:', err);
    res.status(500).json({ error: 'Could not delete past question.' });
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SEND NOTIFICATION TO ALL USERS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.post('/notify-all', adminOnly, async (req, res) => {
  const { title, message, type = 'info' } = req.body;
  if (!title || !message) {
    return res.status(400).json({ error: 'title and message are required.' });
  }
  try {
    const users = await pool.query(
      'SELECT id FROM users WHERE is_verified = TRUE'
    );
    for (const user of users.rows) {
      await pool.query(
        `INSERT INTO notifications (user_id, title, message, type)
         VALUES ($1, $2, $3, $4)`,
        [user.id, title, message, type]
      );
    }
    await logAudit(req.user?.id || null, 'notify_all', 'notification', null, { title, count: users.rows.length });
    res.json({ message: `Notification sent to ${users.rows.length} users.` });
  } catch (err) {
    res.status(500).json({ error: 'Could not send notifications.' });
  }
});

module.exports = router;