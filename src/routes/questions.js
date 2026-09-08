const express = require('express');
const router  = express.Router();
const pool    = require('../config/database');
const authMiddleware = require('../middleware/authMiddleware');

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GET QUESTIONS FOR PRACTICE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.get('/', async (req, res) => {
  const { subject, topic, count = 5, year } = req.query;

  try {
    let   query  = `SELECT * FROM questions WHERE 1=1`;
    const params = [];
    let   n      = 1;

    if (subject) { query += ` AND subject_id = $${n++}`; params.push(subject); }
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
    if (year) { query += ` AND year = $${n++}`; params.push(year); }

    query += ` ORDER BY RANDOM() LIMIT $${n}`;
    params.push(parseInt(count));

    const result = await pool.query(query, params);

    const formatted = result.rows.map((q) => ({
      id:          q.id,
      question:    q.question,
      options: {
        A: q.option_a,
        B: q.option_b,
        C: q.option_c,
        D: q.option_d,
      },
      answer:      q.answer,
      explanation: q.explanation || '',
      year:        q.year,
    }));

    res.json({ questions: formatted, count: formatted.length, source: 'database' });

  } catch (err) {
    console.error('[getQuestions]', err);
    res.status(500).json({ error: 'Could not fetch questions.' });
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SAVE AI-GENERATED QUESTIONS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.post('/save-ai', authMiddleware, async (req, res) => {
  const { subject_id, topic_id, questions } = req.body;

  if (!subject_id || !Array.isArray(questions)) {
    return res.status(400).json({ error: 'subject_id and questions are required.' });
  }

  try {
    const saved = [];
    for (const q of questions) {
      const result = await pool.query(
        `INSERT INTO questions
           (subject_id, topic_id, question, option_a, option_b,
            option_c, option_d, answer, explanation, is_ai)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, TRUE)
         RETURNING id`,
        [subject_id, topic_id || null, q.question,
         q.options?.A || '', q.options?.B || '',
         q.options?.C || '', q.options?.D || '',
         q.answer, q.explanation || '']
      );
      saved.push(result.rows[0].id);
    }
    res.status(201).json({ message: `${saved.length} AI questions saved`, ids: saved });
  } catch (err) {
    console.error('[save-ai]', err);
    res.status(500).json({ error: 'Could not save questions.' });
  }
});

router.get('/past', async (req, res) => {
  const { subject, year, count = 10 } = req.query;

  try {
    let query = `
      SELECT id, question, option_a, option_b, option_c, option_d,
             answer, explanation, year, subject_id
      FROM past_questions
      WHERE 1=1
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
    params.push(parseInt(count, 10));

    const result = await pool.query(query, params);
    const questions = result.rows.map((q) => ({
      id: q.id,
      question: q.question,
      options: { A: q.option_a, B: q.option_b, C: q.option_c, D: q.option_d },
      answer: q.answer,
      explanation: q.explanation || '',
      year: q.year,
      subject_id: q.subject_id,
    }));

    res.json({ questions, count: questions.length, source: 'past_questions' });
  } catch (err) {
    console.error('[getPastQuestions]', err);
    res.status(500).json({ error: 'Could not fetch past questions.' });
  }
});

module.exports = router;
