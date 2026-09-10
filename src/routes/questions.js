const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const authMiddleware = require('../middleware/authMiddleware');
const adminOnly = require('../middleware/adminOnly');

const MAX_COUNT = 50;

function clampCount(raw, fallback = 5) {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(n, MAX_COUNT);
}

function publicQuestion(q) {
  return {
    id: q.id,
    question: q.question,
    options: {
      A: q.option_a,
      B: q.option_b,
      C: q.option_c,
      D: q.option_d,
    },
    year: q.year,
    subject_id: q.subject_id,
  };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GET QUESTIONS FOR PRACTICE
// Authenticated students receive the prompt only — answers stay on the server
// until they submit via POST /quiz/grade (or a past-exam submit).
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.get('/', authMiddleware, async (req, res) => {
  const { subject, topic, count = 5, year } = req.query;

  try {
    let query = `SELECT id, question, option_a, option_b, option_c, option_d, year, subject_id
                 FROM questions
                 WHERE deleted_at IS NULL`;
    const params = [];
    let n = 1;

    if (subject) {
      query += ` AND subject_id = $${n++}`;
      params.push(subject);
    }
    if (topic) {
      if (/^\d+$/.test(String(topic))) {
        query += ` AND topic_id = $${n++}`;
        params.push(parseInt(topic, 10));
      } else {
        query += ` AND topic_id IN (SELECT id FROM topics WHERE LOWER(name) = LOWER($${n++})`;
        params.push(topic);
        if (subject) {
          query += ` AND subject_id = $${n++}`;
          params.push(subject);
        }
        query += `)`;
      }
    }
    if (year) {
      query += ` AND year = $${n++}`;
      params.push(year);
    }

    query += ` ORDER BY RANDOM() LIMIT $${n}`;
    params.push(clampCount(count, 5));

    const result = await pool.query(query, params);
    const formatted = result.rows.map(publicQuestion);

    res.json({ questions: formatted, count: formatted.length, source: 'database' });
  } catch (err) {
    console.error('[getQuestions]', err);
    res.status(500).json({ error: 'Could not fetch questions.' });
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SAVE AI-GENERATED QUESTIONS (admin only)
// Students must not write into the shared question bank.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.post('/save-ai', adminOnly, async (req, res) => {
  const { subject_id, topic_id, questions } = req.body;

  if (!subject_id || !Array.isArray(questions)) {
    return res.status(400).json({ error: 'subject_id and questions are required.' });
  }
  if (questions.length === 0 || questions.length > MAX_COUNT) {
    return res.status(400).json({ error: `Provide between 1 and ${MAX_COUNT} questions.` });
  }

  try {
    const saved = [];
    for (const q of questions) {
      const answer = String(q.answer || '').trim().toUpperCase();
      if (!q.question || !['A', 'B', 'C', 'D'].includes(answer)) continue;

      const result = await pool.query(
        `INSERT INTO questions
           (subject_id, topic_id, question, option_a, option_b,
            option_c, option_d, answer, explanation, is_ai)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, TRUE)
         RETURNING id`,
        [
          subject_id,
          topic_id || null,
          q.question,
          q.options?.A || '',
          q.options?.B || '',
          q.options?.C || '',
          q.options?.D || '',
          answer,
          q.explanation || '',
        ]
      );
      saved.push(result.rows[0].id);
    }
    res.status(201).json({ message: `${saved.length} AI questions saved`, ids: saved });
  } catch (err) {
    console.error('[save-ai]', err);
    res.status(500).json({ error: 'Could not save questions.' });
  }
});

router.get('/past', authMiddleware, async (req, res) => {
  const { subject, year, count = 10 } = req.query;

  try {
    let query = `
      SELECT id, question, option_a, option_b, option_c, option_d, year, subject_id
      FROM past_questions
      WHERE deleted_at IS NULL
    `;
    const params = [];
    let n = 1;

    if (subject) {
      query += ` AND subject_id = $${n++}`;
      params.push(subject);
    }
    if (year) {
      query += ` AND year = $${n++}`;
      params.push(parseInt(year, 10));
    }

    query += ` ORDER BY RANDOM() LIMIT $${n}`;
    params.push(clampCount(count, 10));

    const result = await pool.query(query, params);
    const questions = result.rows.map(publicQuestion);

    res.json({ questions, count: questions.length, source: 'past_questions' });
  } catch (err) {
    console.error('[getPastQuestions]', err);
    res.status(500).json({ error: 'Could not fetch past questions.' });
  }
});

module.exports = router;
