/**
 * AI routes — all endpoints require authentication.
 *
 * POST /api/ai/chat      — multi-turn conversation
 * POST /api/ai/generate  — question / explanation / flashcard generation
 */

const crypto     = require('crypto');
const express    = require('express');
const rateLimit  = require('express-rate-limit');

const pool           = require('../config/database');
const authMiddleware = require('../middleware/authMiddleware');
const { chat }       = require('../services/aiService');

const router = express.Router();
const isProd = process.env.NODE_ENV === 'production';

// ─── Daily limits ─────────────────────────────────────────────────────────────
// Adjust these to match your pricing tier.
const DAILY_CHAT_LIMIT     = parseInt(process.env.AI_DAILY_CHAT_LIMIT     || '30', 10);
const DAILY_GENERATE_LIMIT = parseInt(process.env.AI_DAILY_GENERATE_LIMIT || '20', 10);
const CACHE_TTL_DAYS       = parseInt(process.env.AI_CACHE_TTL_DAYS       || '7',  10);

// ─── Express rate limiter (per-IP, short window) ──────────────────────────────
// This is a fast guard against bursts; the DB counter enforces the daily cap.
const aiLimiter = rateLimit({
  windowMs: 60 * 1000,          // 1 minute
  max: isProd ? 20 : 200,
  message: { error: 'Too many requests. Please slow down.' },
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sha256(str) {
  return crypto.createHash('sha256').update(str).digest('hex');
}

/**
 * Increment the per-user daily counter for a given type ('chat' or 'generate').
 * Returns the new count.
 */
async function incrementUsage(userId, type) {
  const col = type === 'chat' ? 'chat_count' : 'generate_count';
  const result = await pool.query(
    `INSERT INTO ai_usage (user_id, usage_date, ${col})
     VALUES ($1, CURRENT_DATE, 1)
     ON CONFLICT (user_id, usage_date)
     DO UPDATE SET ${col} = ai_usage.${col} + 1
     RETURNING ${col} AS count`,
    [userId]
  );
  return result.rows[0].count;
}

/**
 * Return today's usage counts for a user.
 */
async function getUsage(userId) {
  const result = await pool.query(
    `SELECT chat_count, generate_count
     FROM ai_usage
     WHERE user_id = $1 AND usage_date = CURRENT_DATE`,
    [userId]
  );
  return result.rows[0] || { chat_count: 0, generate_count: 0 };
}

/**
 * Look up a cached response by prompt hash.
 * Returns null if not found or expired.
 */
async function getCached(hash) {
  const result = await pool.query(
    `SELECT response FROM ai_cache
     WHERE prompt_hash = $1
       AND created_at > NOW() - INTERVAL '${CACHE_TTL_DAYS} days'`,
    [hash]
  );
  return result.rows[0]?.response || null;
}

/**
 * Save a response to the cache.
 */
async function setCache(hash, response) {
  await pool.query(
    `INSERT INTO ai_cache (prompt_hash, response)
     VALUES ($1, $2)
     ON CONFLICT (prompt_hash)
     DO UPDATE SET response = EXCLUDED.response, created_at = NOW()`,
    [hash, response]
  );
}

// ─── Prompt sanitisation ──────────────────────────────────────────────────────
// Basic guard against prompt injection in student messages.
const INJECTION_PATTERN = /ignore (previous|all|prior) instructions?|you are now|new persona|disregard/i;

function sanitiseMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw Object.assign(new Error('messages must be a non-empty array.'), { status: 400 });
  }
  if (messages.length > 50) {
    throw Object.assign(new Error('Conversation too long. Start a new chat.'), { status: 400 });
  }
  return messages.map((m) => {
    const role    = ['user', 'assistant', 'system'].includes(m?.role) ? m.role : 'user';
    const content = String(m?.content || '').trim().slice(0, 2000); // hard cap per message
    if (INJECTION_PATTERN.test(content)) {
      throw Object.assign(new Error('Message contains disallowed content.'), { status: 400 });
    }
    return { role, content };
  }).filter((m) => m.content.length > 0);
}

// ─── System prompt ────────────────────────────────────────────────────────────

function buildSystemMessage(context = {}) {
  const { weakTopics = [], selectedSubjects = [], daysToExam = null } = context;

  let personalisation = '';

  if (selectedSubjects.length > 0) {
    personalisation += ` The student is preparing for: ${selectedSubjects.join(', ')}.`;
  }
  if (weakTopics.length > 0) {
    const topList = weakTopics.slice(0, 5).map((t) => t.topic || t).join(', ');
    personalisation += ` Their current weak areas are: ${topList} — gently steer them toward these when relevant.`;
  }
  if (daysToExam !== null && daysToExam >= 0) {
    personalisation += ` The exam is in ${daysToExam} day${daysToExam === 1 ? '' : 's'} — keep urgency and encouragement in mind.`;
  }

  return {
    role: 'system',
    content:
      'You are Malam AI, a patient and encouraging JAMB and WAEC tutor for northern Nigerian ' +
      'secondary school students. Speak simply, use relatable Nigerian examples (markets, farms, ' +
      'local contexts), and occasionally include short Hausa encouragements like "Sai haka!", ' +
      '"Nagode", "Ya yi kyau", "Kada ka damu", "Ba Matsala". Be concise.' +
      personalisation,
  };
}

// ─── POST /api/ai/chat ────────────────────────────────────────────────────────

router.post('/chat', authMiddleware, aiLimiter, async (req, res) => {
  const userId = req.user.id;

  // Check daily cap BEFORE calling the AI
  const usage = await getUsage(userId);
  if (usage.chat_count >= DAILY_CHAT_LIMIT) {
    return res.status(429).json({
      error: `You have reached your daily limit of ${DAILY_CHAT_LIMIT} messages. Come back tomorrow!`,
      limit: DAILY_CHAT_LIMIT,
      used: usage.chat_count,
    });
  }

  let messages;
  try {
    messages = sanitiseMessages(req.body.messages);
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }

  // Optional: persist to a conversation
  const conversationId = req.body.conversation_id ? parseInt(req.body.conversation_id, 10) : null;

  // Load student context to personalise the system prompt
  let studentContext = {};
  try {
    const profileRow = await pool.query(
      `SELECT selected_subjects, exam_date FROM users WHERE id = $1`,
      [userId]
    );
    if (profileRow.rows.length > 0) {
      const { selected_subjects, exam_date } = profileRow.rows[0];
      // Parse selected subjects
      let subjects = [];
      try { subjects = JSON.parse(selected_subjects || '[]'); } catch { subjects = []; }

      // Days to exam
      let daysToExam = null;
      if (exam_date) {
        const examMs = new Date(exam_date).setHours(0, 0, 0, 0);
        const nowMs  = new Date().setHours(0, 0, 0, 0);
        daysToExam   = Math.ceil((examMs - nowMs) / 86400000);
        if (daysToExam < 0) daysToExam = null; // exam already passed
      }

      // Weak topics: top 5 most-wrong topics from quiz answers in the last 30 days
      const weakRows = await pool.query(
        `SELECT qa.question_text AS topic, COUNT(*) AS wrong_count
         FROM quiz_answers qa
         JOIN quiz_attempts qat ON qa.attempt_id = qat.id
         WHERE qat.user_id = $1
           AND qa.is_correct = FALSE
           AND qa.question_text IS NOT NULL
           AND qat.created_at > NOW() - INTERVAL '30 days'
         GROUP BY qa.question_text
         ORDER BY wrong_count DESC
         LIMIT 5`,
        [userId]
      );

      studentContext = {
        selectedSubjects: subjects,
        daysToExam,
        weakTopics: weakRows.rows.map((r) => ({ topic: r.topic })),
      };
    }
  } catch (ctxErr) {
    // Non-fatal — fall back to generic system prompt
    console.warn('[ai/chat] context load failed:', ctxErr.message);
  }

  // Prepend the personalised system prompt
  const payload = [buildSystemMessage(studentContext), ...messages];

  try {
    const reply = await chat(payload);
    await incrementUsage(userId, 'chat');

    // Persist the last user message + AI reply if a conversation is active
    if (conversationId) {
      try {
        const lastUserMsg = messages[messages.length - 1];
        await pool.query(
          `INSERT INTO ai_messages (conversation_id, role, content) VALUES ($1, $2, $3)`,
          [conversationId, 'user', lastUserMsg.content]
        );
        await pool.query(
          `INSERT INTO ai_messages (conversation_id, role, content) VALUES ($1, $2, $3)`,
          [conversationId, 'assistant', reply]
        );
        // bump updated_at so the list sorts correctly
        await pool.query(
          `UPDATE ai_conversations SET updated_at = NOW() WHERE id = $1 AND user_id = $2`,
          [conversationId, userId]
        );
      } catch (dbErr) {
        // Non-fatal — don't fail the response just because persistence failed
        console.warn('[ai/chat] message persist failed:', dbErr.message);
      }
    }

    return res.json({
      reply,
      usage: { used: usage.chat_count + 1, limit: DAILY_CHAT_LIMIT },
    });
  } catch (err) {
    console.error('[POST /ai/chat]', err.message);
    const status = err.status || 500;
    return res.status(status).json({
      error: status === 429
        ? 'The AI service is busy right now. Please try again in a moment.'
        : 'Could not get a response from the AI. Please try again.',
    });
  }
});

// ─── POST /api/ai/generate ────────────────────────────────────────────────────
// Used for: question generation, explanations, flashcards, step-by-step, why-wrong.
// These are cacheable because the same subject+topic+type combo yields the same prompt.

router.post('/generate', authMiddleware, aiLimiter, async (req, res) => {
  const userId = req.user.id;

  const usage = await getUsage(userId);
  if (usage.generate_count >= DAILY_GENERATE_LIMIT) {
    return res.status(429).json({
      error: `You have reached your daily generation limit of ${DAILY_GENERATE_LIMIT}. Come back tomorrow!`,
      limit: DAILY_GENERATE_LIMIT,
      used: usage.generate_count,
    });
  }

  const { type, subject, topic, question, selectedOption, correctOption, count } = req.body;

  const ALLOWED_TYPES = ['explanation', 'questions', 'flashcards', 'step_by_step', 'why_wrong'];
  if (!ALLOWED_TYPES.includes(type)) {
    return res.status(400).json({ error: `Invalid type. Must be one of: ${ALLOWED_TYPES.join(', ')}` });
  }

  // Build the prompt from the request parameters
  let userPrompt;
  try {
    userPrompt = buildGeneratePrompt({ type, subject, topic, question, selectedOption, correctOption, count });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  // Check cache for deterministic prompts (skip why_wrong as it's always unique)
  const cacheKey  = sha256(`${type}:${subject}:${topic}:${count}:${userPrompt}`);
  const useCache  = type !== 'why_wrong';

  if (useCache) {
    const cached = await getCached(cacheKey);
    if (cached) {
      console.log(`[aiService] cache hit for ${type} — ${subject}/${topic}`);
      return res.json({ result: cached, cached: true });
    }
  }

  const payload = [buildSystemMessage(), { role: 'user', content: userPrompt }];

  try {
    const result = await chat(payload);
    await incrementUsage(userId, 'generate');

    if (useCache) {
      setCache(cacheKey, result).catch((e) =>
        console.warn('[aiService] cache write failed:', e.message)
      );
    }

    return res.json({
      result,
      cached: false,
      usage: { used: usage.generate_count + 1, limit: DAILY_GENERATE_LIMIT },
    });
  } catch (err) {
    console.error('[POST /ai/generate]', err.message);
    const status = err.status || 500;
    return res.status(status).json({
      error: status === 429
        ? 'The AI service is busy right now. Please try again in a moment.'
        : 'Could not generate content. Please try again.',
    });
  }
});

// ─── GET /api/ai/usage ────────────────────────────────────────────────────────
// Lets the frontend show the student how many messages they have left today,
// plus the exact UTC timestamp when the counter resets (midnight local day).

router.get('/usage', authMiddleware, async (req, res) => {
  try {
    const usage = await getUsage(req.user.id);

    // Reset happens at the start of the next calendar day (server local midnight).
    // We express it as an ISO timestamp so the client can count down from it.
    const now       = new Date();
    const resetAt   = new Date(now);
    resetAt.setDate(resetAt.getDate() + 1);
    resetAt.setHours(0, 0, 0, 0);
    const secondsUntilReset = Math.max(0, Math.floor((resetAt - now) / 1000));

    return res.json({
      chat: {
        used:  usage.chat_count,
        limit: DAILY_CHAT_LIMIT,
        remaining: Math.max(0, DAILY_CHAT_LIMIT - usage.chat_count),
      },
      generate: {
        used:  usage.generate_count,
        limit: DAILY_GENERATE_LIMIT,
        remaining: Math.max(0, DAILY_GENERATE_LIMIT - usage.generate_count),
      },
      reset_at:           resetAt.toISOString(),
      seconds_until_reset: secondsUntilReset,
    });
  } catch (err) {
    console.error('[GET /ai/usage]', err.message);
    return res.status(500).json({ error: 'Could not fetch usage.' });
  }
});

// ─── POST /api/ai/study-plan ─────────────────────────────────────────────────
// Generates a structured daily study plan based on the student's profile,
// weak topics, and exam countdown.

router.post('/study-plan', authMiddleware, aiLimiter, async (req, res) => {
  const userId = req.user.id;

  const usage = await getUsage(userId);
  if (usage.generate_count >= DAILY_GENERATE_LIMIT) {
    return res.status(429).json({
      error: `You have reached your daily generation limit of ${DAILY_GENERATE_LIMIT}. Come back tomorrow!`,
    });
  }

  try {
    // Load student profile + weak topics from DB
    const profileRow = await pool.query(
      `SELECT name, selected_subjects, exam_date FROM users WHERE id = $1`,
      [userId]
    );
    if (profileRow.rows.length === 0) return res.status(404).json({ error: 'User not found.' });

    const { name, selected_subjects, exam_date } = profileRow.rows[0];
    let subjects = [];
    try { subjects = JSON.parse(selected_subjects || '[]'); } catch { subjects = []; }

    let daysToExam = null;
    if (exam_date) {
      const examMs = new Date(exam_date).setHours(0, 0, 0, 0);
      const nowMs  = new Date().setHours(0, 0, 0, 0);
      daysToExam   = Math.ceil((examMs - nowMs) / 86400000);
      if (daysToExam < 0) daysToExam = null;
    }

    // Top 8 weak topics from quiz history (last 60 days)
    const weakRows = await pool.query(
      `SELECT
         COALESCE(t.name, qat.topic_name, 'General Practice') AS topic,
         s.name AS subject_name,
         COUNT(*) AS wrong_count
       FROM quiz_answers qa
       JOIN quiz_attempts qat ON qa.attempt_id = qat.id
       LEFT JOIN topics t    ON qat.topic_id  = t.id
       LEFT JOIN subjects s  ON qat.subject_id = s.id
       WHERE qat.user_id   = $1
         AND qa.is_correct  = FALSE
         AND qat.created_at > NOW() - INTERVAL '60 days'
       GROUP BY topic, subject_name
       ORDER BY wrong_count DESC
       LIMIT 8`,
      [userId]
    );

    const weakTopics = weakRows.rows;

    // Build a focused study plan prompt
    const subjectList = subjects.length > 0 ? subjects.join(', ') : 'Use of English';
    const examLine    = daysToExam !== null
      ? `The JAMB exam is in ${daysToExam} day${daysToExam === 1 ? '' : 's'}.`
      : 'The exam date has not been set yet.';
    const weakLine    = weakTopics.length > 0
      ? `Their recent weak topics are: ${weakTopics.map((t) => `${t.topic} (${t.subject_name || 'Unknown'})`).join(', ')}.`
      : 'No weak topic data yet — suggest general revision.';

    const prompt =
      `You are Malam AI, a JAMB study coach. Create a focused one-day study plan for a Nigerian SS3 student named ${name || 'the student'}.\n\n` +
      `Subjects registered: ${subjectList}.\n` +
      `${examLine}\n` +
      `${weakLine}\n\n` +
      `Return ONLY valid JSON in this exact shape:\n` +
      `{"plan":[{"time":"e.g. 8:00–9:00 AM","subject":"...","topic":"...","activity":"...","tip":"..."}],"summary":"One encouraging sentence."}\n\n` +
      `Rules:\n` +
      `- Include 4–6 sessions, each 45–60 minutes.\n` +
      `- Prioritise weak topics but include variety.\n` +
      `- Keep activity descriptions short (max 12 words).\n` +
      `- End the summary with a Hausa encouragement.`;

    // Cache study plans per user+day (refresh daily)
    const today    = new Date().toISOString().slice(0, 10);
    const cacheKey = sha256(`study-plan:${userId}:${today}:${subjectList}`);
    const cached   = await getCached(cacheKey);

    if (cached) {
      return res.json({ plan: JSON.parse(cached), cached: true });
    }

    const raw = await chat([buildSystemMessage(), { role: 'user', content: prompt }]);
    await incrementUsage(userId, 'generate');

    // Parse and validate
    let parsed;
    try {
      const cleaned = raw.replace(/```json/gi, '').replace(/```/g, '').trim();
      parsed = JSON.parse(cleaned);
      if (!Array.isArray(parsed.plan)) throw new Error('plan array missing');
    } catch {
      return res.status(500).json({ error: 'AI returned an invalid study plan. Please try again.' });
    }

    // Cache as string
    setCache(cacheKey, JSON.stringify(parsed)).catch(() => {});

    return res.json({ plan: parsed, cached: false });

  } catch (err) {
    console.error('[POST /ai/study-plan]', err.message);
    const status = err.status || 500;
    return res.status(status).json({
      error: status === 429
        ? 'The AI service is busy right now. Please try again in a moment.'
        : 'Could not generate study plan. Please try again.',
    });
  }
});

// ─── Conversations ────────────────────────────────────────────────────────────

// GET /api/ai/conversations — list all conversations for the user (newest first)
router.get('/conversations', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, title, created_at, updated_at
       FROM ai_conversations
       WHERE user_id = $1
       ORDER BY updated_at DESC
       LIMIT 50`,
      [req.user.id]
    );
    return res.json({ conversations: result.rows });
  } catch (err) {
    console.error('[GET /ai/conversations]', err.message);
    return res.status(500).json({ error: 'Could not fetch conversations.' });
  }
});

// POST /api/ai/conversations — create a new conversation
router.post('/conversations', authMiddleware, async (req, res) => {
  const title = String(req.body.title || 'New Chat').trim().slice(0, 100);
  try {
    const result = await pool.query(
      `INSERT INTO ai_conversations (user_id, title) VALUES ($1, $2)
       RETURNING id, title, created_at, updated_at`,
      [req.user.id, title]
    );
    return res.status(201).json({ conversation: result.rows[0] });
  } catch (err) {
    console.error('[POST /ai/conversations]', err.message);
    return res.status(500).json({ error: 'Could not create conversation.' });
  }
});

// GET /api/ai/conversations/:id — load all messages in a conversation
router.get('/conversations/:id', authMiddleware, async (req, res) => {
  const convId = parseInt(req.params.id, 10);
  if (!Number.isInteger(convId)) return res.status(400).json({ error: 'Invalid conversation id.' });

  try {
    // Verify ownership
    const conv = await pool.query(
      `SELECT id, title, created_at, updated_at FROM ai_conversations WHERE id = $1 AND user_id = $2`,
      [convId, req.user.id]
    );
    if (conv.rows.length === 0) return res.status(404).json({ error: 'Conversation not found.' });

    const msgs = await pool.query(
      `SELECT id, role, content, created_at FROM ai_messages
       WHERE conversation_id = $1 ORDER BY created_at ASC`,
      [convId]
    );

    return res.json({
      conversation: conv.rows[0],
      messages: msgs.rows,
    });
  } catch (err) {
    console.error('[GET /ai/conversations/:id]', err.message);
    return res.status(500).json({ error: 'Could not load conversation.' });
  }
});

// PATCH /api/ai/conversations/:id — rename a conversation
router.patch('/conversations/:id', authMiddleware, async (req, res) => {
  const convId = parseInt(req.params.id, 10);
  if (!Number.isInteger(convId)) return res.status(400).json({ error: 'Invalid conversation id.' });

  const title = String(req.body.title || '').trim().slice(0, 100);
  if (!title) return res.status(400).json({ error: 'title is required.' });

  try {
    const result = await pool.query(
      `UPDATE ai_conversations SET title = $1, updated_at = NOW()
       WHERE id = $2 AND user_id = $3
       RETURNING id, title, updated_at`,
      [title, convId, req.user.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Conversation not found.' });
    return res.json({ conversation: result.rows[0] });
  } catch (err) {
    console.error('[PATCH /ai/conversations/:id]', err.message);
    return res.status(500).json({ error: 'Could not rename conversation.' });
  }
});

// DELETE /api/ai/conversations/:id — delete a conversation and all its messages
router.delete('/conversations/:id', authMiddleware, async (req, res) => {
  const convId = parseInt(req.params.id, 10);
  if (!Number.isInteger(convId)) return res.status(400).json({ error: 'Invalid conversation id.' });

  try {
    const result = await pool.query(
      `DELETE FROM ai_conversations WHERE id = $1 AND user_id = $2 RETURNING id`,
      [convId, req.user.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Conversation not found.' });
    return res.json({ success: true });
  } catch (err) {
    console.error('[DELETE /ai/conversations/:id]', err.message);
    return res.status(500).json({ error: 'Could not delete conversation.' });
  }
});

// ─── Prompt builder ───────────────────────────────────────────────────────────

function buildGeneratePrompt({ type, subject, topic, question, selectedOption, correctOption, count }) {
  const safeSubject  = String(subject  || '').trim();
  const safeTopic    = String(topic    || '').trim();
  const safeQuestion = String(question || '').trim();
  const safeSelected = String(selectedOption || '').trim();
  const safeCorrect  = String(correctOption  || '').trim();
  const safeCount    = Math.min(Math.max(parseInt(count, 10) || 5, 1), 20);

  switch (type) {
    case 'explanation':
      if (!safeSubject) throw new Error('subject is required for explanation.');
      return safeTopic
        ? `Explain the topic "${safeTopic}" from ${safeSubject} simply for a northern Nigerian secondary school student. Use a short relatable Nigerian example and finish with 'Ready to test yourself?'. Keep it friendly and encouraging.`
        : `Give a concise overview of ${safeSubject} suitable for secondary students. End with 'Ready to test yourself?'.`;

    case 'questions':
      if (!safeSubject) throw new Error('subject is required for questions.');
      return `Generate ${safeCount} JAMB-style multiple choice questions${safeTopic ? ` about "${safeTopic}"` : ''} in ${safeSubject}. ` +
        `Return ONLY valid JSON: {"questions":[{"question":"...","options":{"A":"...","B":"...","C":"...","D":"..."},"answer":"A","explanation":"..."}]}. ` +
        `Keep language simple and suitable for a Nigerian SS3 student.`;

    case 'flashcards':
      if (!safeSubject) throw new Error('subject is required for flashcards.');
      return `Generate 8 flashcards for the topic "${safeTopic || safeSubject}" in ${safeSubject}. ` +
        `Return ONLY valid JSON: {"cards":[{"front":"...","back":"..."}]}. ` +
        `Each card should be simple and clear for a Nigerian SS3 student. Append a "Memory tip:" to each back field where helpful.`;

    case 'step_by_step':
      if (!safeQuestion) throw new Error('question is required for step_by_step.');
      return `A Nigerian SS3 student got this JAMB question wrong. Show the full step-by-step working in simple English. ` +
        `Use numbered steps. If it is a calculation, show every arithmetic step. End with a one-line memory tip.\n\n` +
        `Question: ${safeQuestion}\nCorrect answer: ${safeCorrect}`;

    case 'why_wrong':
      if (!safeQuestion || !safeSelected || !safeCorrect) {
        throw new Error('question, selectedOption, and correctOption are required for why_wrong.');
      }
      return `A Nigerian SS3 student answered this JAMB question incorrectly. Explain why their answer was wrong ` +
        `and help them understand the correct approach. Use simple English and be encouraging.\n\n` +
        `Question: ${safeQuestion}\nStudent selected: ${safeSelected}\nCorrect answer: ${safeCorrect}\n\n` +
        `Explain in 2-3 sentences.`;

    default:
      throw new Error(`Unknown type: ${type}`);
  }
}

module.exports = router;
