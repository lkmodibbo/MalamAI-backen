const express = require('express');
const router  = express.Router();
const pool    = require('../config/database');

// Get questions by subject and topic
router.get('/', async (req, res) => {
  const { subject, topic, count = 5, year } = req.query;

  try {
    let query  = 'SELECT * FROM questions WHERE 1=1';
    const params = [];
    let   paramCount = 1;

    if (subject) {
      query += ` AND subject_id = $${paramCount++}`;
      params.push(subject);
    }

    if (topic) {
      query += ` AND topic_id = $${paramCount++}`;
      params.push(topic);
    }

    if (year) {
      query += ` AND year = $${paramCount++}`;
      params.push(year);
    }

    query += ` ORDER BY RANDOM() LIMIT $${paramCount}`;
    params.push(parseInt(count));

    const result = await pool.query(query, params);
    res.json({ questions: result.rows });

  } catch (err) {
    console.error('[getQuestions]', err);
    res.status(500).json({ error: 'Could not fetch questions.' });
  }
});

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
    if (topic)   { query += ` AND topic_id   = $${n++}`; params.push(topic);   }
    if (year)    { query += ` AND year        = $${n++}`; params.push(year);    }

    query += ` ORDER BY RANDOM() LIMIT $${n}`;
    params.push(parseInt(count));

    const result = await pool.query(query, params);

    // Format questions to match what your React Native app expects
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

    res.json({
      questions: formatted,
      count:     formatted.length,
      source:    'database',
    });

  } catch (err) {
    console.error('[getQuestions]', err);
    res.status(500).json({ error: 'Could not fetch questions.' });
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GET PAST JAMB QUESTIONS BY YEAR
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.get('/past', async (req, res) => {
  const { subject, year, count = 10 } = req.query;

  try {
    let   query  = `SELECT * FROM questions WHERE year IS NOT NULL`;
    const params = [];
    let   n      = 1;

    if (subject) { query += ` AND subject_id = $${n++}`; params.push(subject); }
    if (year)    { query += ` AND year        = $${n++}`; params.push(year);    }

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

    res.json({ questions: formatted, count: formatted.length });

  } catch (err) {
    console.error('[pastQuestions]', err);
    res.status(500).json({ error: 'Could not fetch past questions.' });
  }
});

module.exports = router;

module.exports = router;