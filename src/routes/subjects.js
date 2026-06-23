const express = require('express');
const router  = express.Router();
const pool    = require('../config/database');

// Get all subjects
router.get('/', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM subjects ORDER BY name');
    res.json({ subjects: result.rows });
  } catch (err) {
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