const express        = require('express');
const router         = express.Router();
const pool           = require('../config/database');
const authMiddleware = require('../middleware/authMiddleware');

// Add bookmark
router.post('/', authMiddleware, async (req, res) => {
  const question_id = parseInt(req.body.question_id, 10);
  if (!Number.isInteger(question_id)) {
    return res.status(400).json({ error: 'A valid question_id is required.' });
  }
  try {
    await pool.query(
      `INSERT INTO bookmarks (user_id, question_id)
       VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [req.user.id, question_id]
    );
    res.status(201).json({ message: 'Question bookmarked.' });
  } catch (err) {
    res.status(500).json({ error: 'Could not bookmark question.' });
  }
});

// Remove bookmark
router.delete('/:questionId', authMiddleware, async (req, res) => {
  try {
    await pool.query(
      `DELETE FROM bookmarks
       WHERE user_id = $1 AND question_id = $2`,
      [req.user.id, req.params.questionId]
    );
    res.json({ message: 'Bookmark removed.' });
  } catch (err) {
    res.status(500).json({ error: 'Could not remove bookmark.' });
  }
});

// Get all bookmarks for user
router.get('/', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
         pq.id,
         pq.question,
         pq.option_a, pq.option_b, pq.option_c, pq.option_d,
         pq.answer, pq.explanation, pq.year,
         s.name AS subject_name,
         b.created_at AS bookmarked_at
       FROM bookmarks b
       JOIN past_questions pq ON b.question_id = pq.id
       JOIN subjects s ON pq.subject_id = s.id
       WHERE b.user_id = $1
       ORDER BY b.created_at DESC`,
      [req.user.id]
    );
    res.json({ bookmarks: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Could not fetch bookmarks.' });
  }
});

module.exports = router;