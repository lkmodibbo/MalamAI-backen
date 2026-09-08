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
    const title = `${streak}-day streak!`;
    const existing = await pool.query(
      `SELECT id FROM notifications WHERE user_id = $1 AND type = 'streak' AND title = $2 LIMIT 1`,
      [userId, title]
    );
    if (existing.rows.length > 0) return;

    await pool.query(
      `INSERT INTO notifications (user_id, title, message, type)
       VALUES ($1, $2, $3, 'streak')`,
      [
        userId,
        title,
        `Incredible! You have studied ${streak} days in a row. Ka yi kyau sosai!`,
      ]
    );
  }
}
async function resolveTopicId(subjectId, topicId, topicName) {
  if (topicId) return topicId;
  if (!topicName || !subjectId) return null;

  const existing = await pool.query(
    `SELECT id FROM topics WHERE subject_id = $1 AND LOWER(name) = LOWER($2) LIMIT 1`,
    [subjectId, topicName]
  );
  if (existing.rows.length > 0) return existing.rows[0].id;

  const created = await pool.query(
    `INSERT INTO topics (subject_id, name) VALUES ($1, $2) RETURNING id`,
    [subjectId, topicName]
  );
  return created.rows[0].id;
}

// Save a completed quiz attempt (protected)
router.post('/attempt', authMiddleware, async (req, res) => {
  const { subject_id, topic_id, topic_name, score, total, time_taken, answers } = req.body;
  const user_id = req.user.id;

  try {
    let resolvedTopicId = topic_id || null;
    try {
      resolvedTopicId = await resolveTopicId(subject_id, topic_id, topic_name);
    } catch (err) {
      console.warn('[saveAttempt] topic resolve skipped', err.message);
    }

    const attemptResult = await pool.query(
      `INSERT INTO quiz_attempts (user_id, subject_id, topic_id, topic_name, score, total, time_taken)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [user_id, subject_id || null, resolvedTopicId, topic_name || null, score, total, time_taken || 0]
    );

    const attempt_id = attemptResult.rows[0].id;

    if (answers && answers.length > 0) {
      for (const answer of answers) {
        const parsedId = parseInt(answer.question_id, 10);
        const questionId = Number.isInteger(parsedId) ? parsedId : null;
        await pool.query(
          `INSERT INTO quiz_answers
             (attempt_id, question_id, selected, is_correct, time_spent, question_text, correct_answer)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            attempt_id,
            questionId,
            answer.selected || '',
            Boolean(answer.is_correct),
            answer.time_spent || 0,
            answer.question_text || null,
            answer.correct || null,
          ]
        );
      }
    }

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

    await checkAndNotifyStreak(user_id, pool);

    res.status(201).json({
      message: 'Quiz saved successfully!',
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
      `SELECT qa.*, s.name as subject_name, COALESCE(t.name, qa.topic_name) as topic_name
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
         ROUND(AVG(score::decimal / NULLIF(total, 0) * 100), 1) AS average_score,
         SUM(score)                                  AS total_correct,
         SUM(total)                                  AS total_questions
       FROM quiz_attempts
       WHERE user_id = $1 AND total > 0`,
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