const express = require('express');
const router  = express.Router();
const pool    = require('../config/database');

// Simple admin key check — 
// anyone with this key can add subjects and topics
function adminOnly(req, res, next) {
  const key = req.headers['x-admin-key'];
  if (key !== process.env.ADMIN_SECRET_KEY) {
    return res.status(403).json({ error: 'Admin access only.' });
  }
  next();
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ADD A NEW SUBJECT
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.post('/subjects', adminOnly, async (req, res) => {
  const { id, name, emoji } = req.body;

  if (!id || !name) {
    return res.status(400).json({ error: 'id and name are required.' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO subjects (id, name, emoji)
       VALUES ($1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET name = $2, emoji = $3
       RETURNING *`,
      [id.toLowerCase(), name, emoji || null]
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

  try {
    const added = [];
    for (const s of subjects) {
      const result = await pool.query(
        `INSERT INTO subjects (id, name, emoji)
         VALUES ($1, $2, $3)
         ON CONFLICT (id) DO UPDATE SET name = $2, emoji = $3
         RETURNING *`,
        [s.id.toLowerCase(), s.name, s.emoji || null]
      );
      added.push(result.rows[0]);
    }
    res.status(201).json({
      message: `${added.length} subjects added successfully`,
      subjects: added,
    });
  } catch (err) {
    console.error('[admin] bulk add subjects failed:', err);
    res.status(500).json({ error: 'Could not add subjects.' });
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ADD A NEW TOPIC
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.post('/topics', adminOnly, async (req, res) => {
  const { subject_id, name } = req.body;

  if (!subject_id || !name) {
    return res.status(400).json({ error: 'subject_id and name are required.' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO topics (subject_id, name)
       VALUES ($1, $2)
       RETURNING *`,
      [subject_id.toLowerCase(), name]
    );
    res.status(201).json({
      message: 'Topic added successfully',
      topic: result.rows[0],
    });
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

  try {
    const added = [];
    for (const t of topics) {
      const result = await pool.query(
        `INSERT INTO topics (subject_id, name)
         VALUES ($1, $2)
         RETURNING *`,
        [t.subject_id.toLowerCase(), t.name]
      );
      added.push(result.rows[0]);
    }
    res.status(201).json({
      message: `${added.length} topics added successfully`,
      topics: added,
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
    await pool.query('DELETE FROM topics WHERE id = $1', [req.params.id]);
    res.json({ message: 'Topic deleted successfully' });
  } catch (err) {
    console.error('[admin] delete topic failed:', err);
    res.status(500).json({ error: 'Could not delete topic.' });
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GET ALL SUBJECTS WITH TOPIC COUNT
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.get('/overview', adminOnly, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        s.id,
        s.name,
        s.emoji,
        COUNT(t.id) AS topic_count
      FROM subjects s
      LEFT JOIN topics t ON t.subject_id = s.id
      GROUP BY s.id, s.name, s.emoji
      ORDER BY s.name
    `);
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

  try {
    const added  = [];
    const errors = [];

    for (const [i, q] of questions.entries()) {
      try {
        const result = await pool.query(
          `INSERT INTO questions
             (subject_id, topic_id, question, option_a, option_b,
              option_c, option_d, answer, explanation, year, is_ai)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, FALSE)
           RETURNING id, question`,
          [q.subject_id, q.topic_id || null, q.question,
           q.option_a, q.option_b, q.option_c, q.option_d,
           q.answer.toUpperCase(), q.explanation || null, q.year || null]
        );
        added.push(result.rows[0]);
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
    await pool.query('DELETE FROM questions WHERE id = $1', [req.params.id]);
    res.json({ message: 'Question deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Could not delete question.' });
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GET ALL QUESTIONS (with filters)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.get('/questions', adminOnly, async (req, res) => {
  const { subject, topic, year, page = 1, limit = 20 } = req.query;
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

  const added  = [];
  const errors = [];

  for (const [i, q] of questions.entries()) {
    if (!q.subject_id || !q.year || !q.question ||
        !q.option_a || !q.option_b || !q.option_c || !q.option_d || !q.answer) {
      errors.push({ index: i, error: 'Missing required fields' });
      continue;
    }
    try {
      const result = await pool.query(
        `INSERT INTO past_questions
           (subject_id, year, question, option_a, option_b, option_c, option_d, answer, explanation)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING id`,
        [q.subject_id, parseInt(q.year), q.question,
         q.option_a, q.option_b, q.option_c, q.option_d,
         q.answer.toUpperCase(), q.explanation || null]
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
  const { page = 1, limit = 20 } = req.query;
  const offset = (page - 1) * limit;
  try {
    const result = await pool.query(
      `SELECT
         u.id, u.name, u.email, u.is_verified, u.created_at,
         COUNT(qa.id) AS quiz_count
       FROM users u
       LEFT JOIN quiz_attempts qa ON qa.user_id = u.id
       GROUP BY u.id
       ORDER BY u.created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    res.json({ users: result.rows, page: Number(page) });
  } catch (err) {
    res.status(500).json({ error: 'Could not fetch users.' });
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
    res.json({ message: `Notification sent to ${users.rows.length} users.` });
  } catch (err) {
    res.status(500).json({ error: 'Could not send notifications.' });
  }
});

module.exports = router;