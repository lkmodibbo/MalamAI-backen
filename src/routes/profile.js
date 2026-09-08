const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const authMiddleware = require('../middleware/authMiddleware');

function parseSubjects(raw) {
  if (!raw) return ['english'];
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : ['english'];
  } catch {
    return ['english'];
  }
}

router.get('/', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, email, exam_date, selected_subjects, avatar_uri,
              onboarding_complete, is_verified, created_at
       FROM users WHERE id = $1`,
      [req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const user = result.rows[0];
    res.json({
      profile: {
        id: user.id,
        name: user.name,
        email: user.email,
        examDate: user.exam_date,
        selectedSubjects: parseSubjects(user.selected_subjects),
        avatarUri: user.avatar_uri,
        onboardingComplete: Boolean(user.onboarding_complete),
        isVerified: user.is_verified,
        createdAt: user.created_at,
      },
    });
  } catch (err) {
    console.error('[profile get]', err);
    res.status(500).json({ error: 'Could not fetch profile.' });
  }
});

router.put('/', authMiddleware, async (req, res) => {
  const { name, examDate, selectedSubjects, avatarUri, onboardingComplete } = req.body;

  try {
    const current = await pool.query(
      `SELECT name, exam_date, selected_subjects, avatar_uri, onboarding_complete
       FROM users WHERE id = $1`,
      [req.user.id]
    );

    if (current.rows.length === 0) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const row = current.rows[0];
    const nextName = typeof name === 'string' && name.trim() ? name.trim() : row.name;
    let nextExamDate = row.exam_date;
    if (examDate !== undefined) {
      if (!examDate) {
        nextExamDate = null;
      } else {
        const parsed = new Date(examDate);
        nextExamDate = Number.isNaN(parsed.getTime()) ? row.exam_date : parsed.toISOString().slice(0, 10);
      }
    }

    let nextSubjects = row.selected_subjects;
    if (selectedSubjects !== undefined) {
      const list = Array.isArray(selectedSubjects) ? selectedSubjects.filter(Boolean) : [];
      if (!list.includes('english')) list.unshift('english');
      nextSubjects = JSON.stringify(list.length > 0 ? list : ['english']);
    }

    const isRemoteAvatar = typeof avatarUri === 'string'
      && (avatarUri.startsWith('http://') || avatarUri.startsWith('https://'));
    const nextAvatar = avatarUri === undefined
      ? row.avatar_uri
      : (isRemoteAvatar ? avatarUri : row.avatar_uri);
    const nextOnboarding = onboardingComplete === undefined
      ? row.onboarding_complete
      : Boolean(onboardingComplete);

    const updated = await pool.query(
      `UPDATE users
       SET name = $1,
           exam_date = $2,
           selected_subjects = $3,
           avatar_uri = $4,
           onboarding_complete = $5
       WHERE id = $6
       RETURNING id, name, email, exam_date, selected_subjects, avatar_uri, onboarding_complete`,
      [nextName, nextExamDate, nextSubjects, nextAvatar, nextOnboarding, req.user.id]
    );

    const user = updated.rows[0];
    res.json({
      message: 'Profile saved.',
      profile: {
        id: user.id,
        name: user.name,
        email: user.email,
        examDate: user.exam_date,
        selectedSubjects: parseSubjects(user.selected_subjects),
        avatarUri: user.avatar_uri,
        onboardingComplete: Boolean(user.onboarding_complete),
      },
    });
  } catch (err) {
    console.error('[profile put]', err);
    res.status(500).json({ error: 'Could not save profile.' });
  }
});

module.exports = router;
