const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const authMiddleware = require('../middleware/authMiddleware');

router.post('/', authMiddleware, async (req, res) => {
  const {
    subject_ids,
    subject_scores,
    total_score,
    total_possible,
    predicted_score,
    time_taken,
  } = req.body;

  if (!Array.isArray(subject_scores)) {
    return res.status(400).json({ error: 'subject_scores array is required.' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO mock_exam_attempts
         (user_id, subject_ids, subject_scores, total_score, total_possible, predicted_score, time_taken)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        req.user.id,
        JSON.stringify(subject_ids || []),
        JSON.stringify(subject_scores),
        total_score || 0,
        total_possible || 0,
        predicted_score || 0,
        time_taken || 0,
      ]
    );

    await pool.query(
      `INSERT INTO streaks (user_id, current_streak, last_active)
       VALUES ($1, 1, CURRENT_DATE)
       ON CONFLICT (user_id) DO UPDATE SET
         current_streak = CASE
           WHEN streaks.last_active = CURRENT_DATE - 1 THEN streaks.current_streak + 1
           WHEN streaks.last_active = CURRENT_DATE THEN streaks.current_streak
           ELSE 1
         END,
         longest_streak = GREATEST(streaks.longest_streak,
           CASE
             WHEN streaks.last_active = CURRENT_DATE - 1 THEN streaks.current_streak + 1
             ELSE 1
           END),
         last_active = CURRENT_DATE`,
      [req.user.id]
    );

    res.status(201).json({
      message: 'Mock exam saved.',
      attempt: result.rows[0],
    });
  } catch (err) {
    console.error('[mock exam save]', err);
    res.status(500).json({ error: 'Could not save mock exam.' });
  }
});

router.get('/history', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, subject_ids, subject_scores, total_score, total_possible,
              predicted_score, time_taken, created_at
       FROM mock_exam_attempts
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 20`,
      [req.user.id]
    );
    res.json({ history: result.rows });
  } catch (err) {
    console.error('[mock exam history]', err);
    res.status(500).json({ error: 'Could not fetch mock exam history.' });
  }
});

module.exports = router;
