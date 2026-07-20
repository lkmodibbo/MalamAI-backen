const express        = require('express');
const router         = express.Router();
const pool           = require('../config/database');
const authMiddleware = require('../middleware/authMiddleware');


// Add this helper function at the top of quiz.js
async function checkAndNotifyStreak(userId, pool) {
  const result = await pool.query(
    'SELECT current_streak FROM streaks WHERE user_id = $1',
    [userId]
  );

  if (result.rows.length === 0) return;

  const streak = result.rows[0].current_streak;
  const milestones = [3, 7, 14, 30, 60, 100];

  if (milestones.includes(streak)) {
    await pool.query(
      `INSERT INTO notifications (user_id, title, message, type)
       VALUES ($1, $2, $3, 'streak')`,
      [
        userId,
        `🔥 ${streak}-day streak!`,
        `Incredible! You have studied ${streak} days in a row. Ka yi kyau sosai!`,
      ]
    );
  }
}
// Save a completed quiz attempt (protected)
router.post('/attempt', authMiddleware, async (req, res) => {
  const { subject_id, topic_id, score, total, time_taken, answers } = req.body;
  const user_id = req.user.id;

  try {
    // Save the attempt
    const attemptResult = await pool.query(
      `INSERT INTO quiz_attempts (user_id, subject_id, topic_id, score, total, time_taken)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [user_id, subject_id, topic_id, score, total, time_taken]
    );

    const attempt_id = attemptResult.rows[0].id;

    // Save each individual answer
    if (answers && answers.length > 0) {
      for (const answer of answers) {
        await pool.query(
          `INSERT INTO quiz_answers (attempt_id, question_id, selected, is_correct, time_spent)
           VALUES ($1, $2, $3, $4, $5)`,
          [attempt_id, answer.question_id, answer.selected, answer.is_correct, answer.time_spent]
        );
      }
    }

    // Update streak
    await pool.query(
      `INSERT INTO streaks (user_id, current_streak, last_active)
       VALUES ($1, 1, CURRENT_DATE)
       ON CONFLICT (user_id) DO UPDATE SET
         current_streak = CASE
           WHEN streaks.last_active = CURRENT_DATE - 1 
           THEN streaks.current_streak + 1
           WHEN streaks.last_active = CURRENT_DATE 
           THEN streaks.current_streak
           ELSE 1
         END,
         longest_streak = GREATEST(streaks.longest_streak,
           CASE
             WHEN streaks.last_active = CURRENT_DATE - 1 
             THEN streaks.current_streak + 1
             ELSE 1
           END),
         last_active = CURRENT_DATE`,
      [user_id]
    );

    res.status(201).json({
      message:    'Quiz saved successfully!',
      attempt_id,
    });

  } catch (err) {
    console.error('[saveAttempt]', err);
    res.status(500).json({ error: 'Could not save quiz attempt.' });
  }
});

// Get quiz history for logged in student
router.get('/history', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT qa.*, s.name as subject_name, s.emoji, t.name as topic_name
       FROM quiz_attempts qa
       LEFT JOIN subjects s ON qa.subject_id = s.id
       LEFT JOIN topics   t ON qa.topic_id   = t.id
       WHERE qa.user_id = $1
       ORDER BY qa.created_at DESC
       LIMIT 20`,
      [req.user.id]
    );

    res.json({ history: result.rows });

  } catch (err) {
    console.error('[getHistory]', err);
    res.status(500).json({ error: 'Could not fetch quiz history.' });
  }
});

// Get student stats
router.get('/stats', authMiddleware, async (req, res) => {
  try {
    const stats = await pool.query(
      `SELECT
         COUNT(*)                                    AS total_quizzes,
         ROUND(AVG(score::decimal / total * 100), 1) AS average_score,
         SUM(score)                                  AS total_correct,
         SUM(total)                                  AS total_questions
       FROM quiz_attempts
       WHERE user_id = $1`,
      [req.user.id]
    );

    const streak = await pool.query(
      'SELECT current_streak, longest_streak FROM streaks WHERE user_id = $1',
      [req.user.id]
    );

    res.json({
      stats:  stats.rows[0],
      streak: streak.rows[0] || { current_streak: 0, longest_streak: 0 },
    });

  } catch (err) {
    console.error('[getStats]', err);
    res.status(500).json({ error: 'Could not fetch stats.' });
  }
});

module.exports = router;