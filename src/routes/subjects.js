const express = require('express');
const router  = express.Router();
const pool    = require('../config/database');

// Get all subjects, each with its topic names. Topics are included here so the
// client does not have to follow up with one request per subject.
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT s.id,
              s.name,
              COALESCE(
                ARRAY_AGG(t.name ORDER BY t.name) FILTER (WHERE t.name IS NOT NULL),
                '{}'
              ) AS topics
       FROM subjects s
       LEFT JOIN topics t ON t.subject_id = s.id
       GROUP BY s.id, s.name
       ORDER BY s.name`
    );
    res.json({ subjects: result.rows });
  } catch (err) {
    console.error('[subjects] list failed:', err);
    res.status(500).json({ error: 'Could not fetch subjects.' });
  }
});

// Get topics for a subject
router.get('/:subjectId/topics', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM topics WHERE subject_id = $1 ORDER BY name',
      [req.params.subjectId]
    );
    res.json({ topics: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Could not fetch topics.' });
  }
});

module.exports = router;