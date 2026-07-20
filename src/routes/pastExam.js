const express        = require('express');
const router         = express.Router();
const pool           = require('../config/database');
const authMiddleware = require('../middleware/authMiddleware');

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GET AVAILABLE YEARS FOR A SUBJECT
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.get('/years/:subjectId', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT 
         year,
         COUNT(id) AS question_count
       FROM past_questions
       WHERE subject_id = $1
       GROUP BY year
       ORDER BY year DESC`,
      [req.params.subjectId]
    );

    res.json({
      subject_id: req.params.subjectId,
      years:      result.rows,
    });

  } catch (err) {
    console.error('[pastExam] get years:', err);
    res.status(500).json({ error: 'Could not fetch available years.' });
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GET QUESTIONS FOR A SUBJECT AND YEAR
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.get('/questions', async (req, res) => {
  const { subject_id, year } = req.query;

  if (!subject_id || !year) {
    return res.status(400).json({ error: 'subject_id and year are required.' });
  }

  try {
    const result = await pool.query(
      `SELECT 
         id,
         question,
         option_a,
         option_b,
         option_c,
         option_d,
         year
       FROM past_questions
       WHERE subject_id = $1 AND year = $2
       ORDER BY id`,
      [subject_id, parseInt(year)]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: `No past questions found for ${subject_id} in ${year}.`,
      });
    }

    // Format for React Native — do NOT send answer here
    // Answer is only revealed after submission
    const questions = result.rows.map((q) => ({
      id:       q.id,
      question: q.question,
      year:     q.year,
      options: {
        A: q.option_a,
        B: q.option_b,
        C: q.option_c,
        D: q.option_d,
      },
    }));

    res.json({
      subject_id,
      year:      parseInt(year),
      questions,
      total:     questions.length,
    });

  } catch (err) {
    console.error('[pastExam] get questions:', err);
    res.status(500).json({ error: 'Could not fetch past questions.' });
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SUBMIT PAST EXAM ANSWERS
// Backend checks right/wrong — student never sees answers until submission
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.post('/submit', authMiddleware, async (req, res) => {
  const { subject_id, year, answers, time_taken } = req.body;
  const user_id = req.user.id;

  // answers format: [{ question_id: 1, selected: 'A' }, ...]
  if (!subject_id || !year || !Array.isArray(answers)) {
    return res.status(400).json({
      error: 'subject_id, year and answers array are required.',
    });
  }

  try {
    // Get correct answers from database
    const questionIds = answers.map((a) => a.question_id);

    const correctAnswers = await pool.query(
      `SELECT id, answer, explanation, question,
              option_a, option_b, option_c, option_d
       FROM past_questions
       WHERE id = ANY($1::int[])`,
      [questionIds]
    );

    // Build a map for quick lookup
    const answerMap = {};
    correctAnswers.rows.forEach((row) => {
      answerMap[row.id] = row;
    });

    // Mark each answer right or wrong
    const results = answers.map((a) => {
      const correct     = answerMap[a.question_id];
      const is_correct  = correct && a.selected?.toUpperCase() === correct.answer;

      return {
        question_id:  a.question_id,
        question:     correct?.question     || '',
        selected:     a.selected            || '',
        correct:      correct?.answer       || '',
        is_correct:   Boolean(is_correct),
        explanation:  correct?.explanation  || '',
        options: {
          A: correct?.option_a || '',
          B: correct?.option_b || '',
          C: correct?.option_c || '',
          D: correct?.option_d || '',
        },
      };
    });

    const score = results.filter((r) => r.is_correct).length;
    const total = results.length;

    // Save attempt to database
    const attemptResult = await pool.query(
      `INSERT INTO past_exam_attempts
         (user_id, subject_id, year, score, total, time_taken)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [user_id, subject_id, parseInt(year), score, total, time_taken || 0]
    );

    const attempt_id = attemptResult.rows[0].id;

    // Save individual answers
    for (const result of results) {
      await pool.query(
        `INSERT INTO past_exam_answers
           (attempt_id, question_id, selected, is_correct)
         VALUES ($1, $2, $3, $4)`,
        [attempt_id, result.question_id, result.selected, result.is_correct]
      );
    }

    res.json({
      message:    'Exam submitted successfully',
      attempt_id,
      score,
      total,
      percent:    Math.round((score / total) * 100),
      results,    // full breakdown with correct answers now revealed
    });

  } catch (err) {
    console.error('[pastExam] submit:', err);
    res.status(500).json({ error: 'Could not submit exam.' });
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GET PAST EXAM HISTORY FOR A USER
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.get('/history', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT 
         pea.id,
         pea.subject_id,
         s.name   AS subject_name,
         s.emoji,
         pea.year,
         pea.score,
         pea.total,
         ROUND(pea.score::decimal / pea.total * 100) AS percent,
         pea.time_taken,
         pea.completed_at
       FROM past_exam_attempts pea
       JOIN subjects s ON pea.subject_id = s.id
       WHERE pea.user_id = $1
       ORDER BY pea.completed_at DESC
       LIMIT 20`,
      [req.user.id]
    );

    res.json({ history: result.rows });

  } catch (err) {
    console.error('[pastExam] history:', err);
    res.status(500).json({ error: 'Could not fetch exam history.' });
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GET STATS FOR A USER PER SUBJECT
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.get('/stats', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
         s.name                                          AS subject_name,
         s.emoji,
         COUNT(pea.id)                                   AS attempts,
         ROUND(AVG(pea.score::decimal / pea.total * 100),1) AS average_percent,
         MAX(ROUND(pea.score::decimal / pea.total * 100))   AS best_percent
       FROM past_exam_attempts pea
       JOIN subjects s ON pea.subject_id = s.id
       WHERE pea.user_id = $1
       GROUP BY s.id, s.name, s.emoji
       ORDER BY average_percent DESC`,
      [req.user.id]
    );

    res.json({ stats: result.rows });

  } catch (err) {
    console.error('[pastExam] stats:', err);
    res.status(500).json({ error: 'Could not fetch stats.' });
  }
});

module.exports = router;