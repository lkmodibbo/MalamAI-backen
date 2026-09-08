const express        = require('express');
const router         = express.Router();
const pool           = require('../config/database');
const authMiddleware = require('../middleware/authMiddleware');

// Global leaderboard — top 20 students by average score
router.get('/global', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        u.id,
        u.name,
        COUNT(qa.id)                                        AS total_quizzes,
        ROUND(AVG(qa.score::decimal / NULLIF(qa.total, 0) * 100), 1)  AS average_score,
        SUM(qa.score)                                       AS total_correct
      FROM quiz_attempts qa
      JOIN users u ON qa.user_id = u.id
      WHERE u.is_verified = TRUE AND qa.total > 0
        AND COALESCE(u.is_admin, FALSE) = FALSE
      GROUP BY u.id, u.name
      HAVING COUNT(qa.id) >= 3
      ORDER BY average_score DESC
      LIMIT 20
    `);

    res.json({ leaderboard: result.rows });
  } catch (err) {
    console.error('[leaderboard global]', err);
    res.status(500).json({ error: 'Could not fetch leaderboard.' });
  }
});

// Subject leaderboard
router.get('/subject/:subjectId', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        u.id,
        u.name,
        COUNT(qa.id)                                        AS attempts,
        ROUND(AVG(qa.score::decimal / NULLIF(qa.total, 0) * 100), 1)  AS average_score,
        MAX(ROUND(qa.score::decimal / NULLIF(qa.total, 0) * 100))      AS best_score
      FROM quiz_attempts qa
      JOIN users u ON qa.user_id = u.id
      WHERE qa.subject_id = $1 AND u.is_verified = TRUE AND qa.total > 0
        AND COALESCE(u.is_admin, FALSE) = FALSE
      GROUP BY u.id, u.name
      HAVING COUNT(qa.id) >= 2
      ORDER BY average_score DESC
      LIMIT 20
    `, [req.params.subjectId]);

    res.json({ leaderboard: result.rows, subject_id: req.params.subjectId });
  } catch (err) {
    console.error('[leaderboard subject]', err);
    res.status(500).json({ error: 'Could not fetch leaderboard.' });
  }
});

// Get current user rank
router.get('/my-rank', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(`
      WITH ranked AS (
        SELECT
          u.id,
          u.name,
          ROUND(AVG(qa.score::decimal / NULLIF(qa.total, 0) * 100), 1) AS average_score,
          RANK() OVER (
            ORDER BY AVG(qa.score::decimal / NULLIF(qa.total, 0) * 100) DESC
          ) AS rank
        FROM quiz_attempts qa
        JOIN users u ON qa.user_id = u.id
        WHERE u.is_verified = TRUE AND qa.total > 0
        AND COALESCE(u.is_admin, FALSE) = FALSE
        GROUP BY u.id, u.name
        HAVING COUNT(qa.id) >= 3
      )
      SELECT * FROM ranked WHERE id = $1
    `, [req.user.id]);

    if (result.rows.length === 0) {
      return res.json({
        rank:    null,
        message: 'Complete at least 3 quizzes to appear on the leaderboard.',
      });
    }

    res.json({ rank: result.rows[0] });
  } catch (err) {
    console.error('[leaderboard my-rank]', err);
    res.status(500).json({ error: 'Could not fetch rank.' });
  }
});

module.exports = router;