const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const authMiddleware = require('../middleware/authMiddleware');

router.get('/', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, subject_id, subject_name, topic, note,
              (EXTRACT(EPOCH FROM updated_at) * 1000)::bigint AS timestamp
       FROM notes
       WHERE user_id = $1
       ORDER BY updated_at DESC`,
      [req.user.id]
    );
    res.json({ notes: result.rows });
  } catch (err) {
    console.error('[notes get]', err);
    res.status(500).json({ error: 'Could not fetch notes.' });
  }
});

router.post('/', authMiddleware, async (req, res) => {
  const { subject_id, subject_name, topic, note } = req.body;

  if (!topic) {
    return res.status(400).json({ error: 'topic is required.' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO notes (user_id, subject_id, subject_name, topic, note)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, subject_id, topic)
       DO UPDATE SET
         note = EXCLUDED.note,
         subject_name = EXCLUDED.subject_name,
         updated_at = NOW()
       RETURNING id, subject_id, subject_name, topic, note,
                 (EXTRACT(EPOCH FROM updated_at) * 1000)::bigint AS timestamp`,
      [
        req.user.id,
        subject_id || 'unknown',
        subject_name || '',
        String(topic).trim(),
        note || '',
      ]
    );
    res.status(201).json({ note: result.rows[0] });
  } catch (err) {
    console.error('[notes post]', err);
    res.status(500).json({ error: 'Could not save note.' });
  }
});

router.delete('/', authMiddleware, async (req, res) => {
  const { subject_id, topic } = req.body;
  if (!topic) {
    return res.status(400).json({ error: 'topic is required.' });
  }

  try {
    await pool.query(
      `DELETE FROM notes WHERE user_id = $1 AND subject_id = $2 AND topic = $3`,
      [req.user.id, subject_id || 'unknown', String(topic).trim()]
    );
    res.json({ message: 'Note deleted.' });
  } catch (err) {
    console.error('[notes delete]', err);
    res.status(500).json({ error: 'Could not delete note.' });
  }
});

module.exports = router;
