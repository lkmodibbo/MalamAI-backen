/**
 * aiService.js
 * Server-side AI provider — keeps API keys off the client.
 * Primary: Groq (with model fallback chain)
 * Fallback: Gemini (if all Groq models are quota-exhausted)
 */

const GROQ_MODELS = [
  process.env.GROQ_PRIMARY_MODEL || 'llama-3.3-70b-versatile',
  'llama-3.1-8b-instant',
  'gemma2-9b-it',
];

function isQuotaError(status) {
  return status === 429;
}

// ─── Groq ────────────────────────────────────────────────────────────────────

async function callGroq(messages) {
  const apiKey  = process.env.GROQ_API_KEY;
  const endpoint = process.env.GROQ_API_URL || 'https://api.groq.com/openai/v1/chat/completions';

  if (!apiKey) throw new Error('GROQ_API_KEY is not configured on the server.');

  let lastError = null;

  for (const model of GROQ_MODELS) {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: 0.7,
          max_tokens: 4096,
        }),
      });

      if (!res.ok) {
        const raw = await res.text();
        let message = raw;
        try { message = JSON.parse(raw)?.error?.message || raw; } catch { /* noop */ }

        const err = new Error(`Groq error ${res.status}: ${message}`);
        err.status = res.status;

        if (isQuotaError(res.status)) {
          console.warn(`[aiService] Groq model ${model} quota hit — trying next`);
          lastError = err;
          continue;
        }
        throw err;
      }

      const data = await res.json();
      const text = data?.choices?.[0]?.message?.content || '';
      if (!text) throw new Error(`Groq returned empty response from model: ${model}`);

      console.log(`[aiService] Groq responded using model: ${model}`);
      return text;

    } catch (err) {
      if (isQuotaError(err.status)) { lastError = err; continue; }
      throw err;
    }
  }

  // All Groq models exhausted — bubble up so caller can try Gemini
  const exhausted = new Error('All Groq models quota-exhausted.');
  exhausted.groqExhausted = true;
  throw exhausted;
}

// ─── Gemini ──────────────────────────────────────────────────────────────────

async function callGemini(messages) {
  const apiKey  = process.env.GEMINI_API_KEY;
  const endpoint = process.env.GEMINI_API_URL;

  if (!apiKey || !endpoint) {
    throw new Error('Gemini is not configured (GEMINI_API_KEY / GEMINI_API_URL missing).');
  }

  // Convert OpenAI-style messages array to a single prompt for Gemini
  const prompt = messages
    .map((m) => `${m.role === 'assistant' ? 'Malam AI' : 'Student'}: ${m.content}`)
    .join('\n\n');

  const url = (() => {
    try {
      const u = new URL(endpoint);
      u.searchParams.set('key', apiKey);
      return u.toString();
    } catch {
      const sep = endpoint.includes('?') ? '&' : '?';
      return `${endpoint}${sep}key=${encodeURIComponent(apiKey)}`;
    }
  })();

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.7, maxOutputTokens: 4096 },
    }),
  });

  if (!res.ok) {
    const raw = await res.text();
    let message = raw;
    try { message = JSON.parse(raw)?.error?.message || raw; } catch { /* noop */ }
    const err = new Error(`Gemini error ${res.status}: ${message}`);
    err.status = res.status;
    throw err;
  }

  const data = await res.json();
  const parts = data?.candidates?.[0]?.content?.parts;
  const text  = Array.isArray(parts) ? parts.map((p) => p.text || '').join('\n').trim() : '';

  if (!text) {
    const blockReason = data?.promptFeedback?.blockReason;
    throw new Error(blockReason ? `Gemini blocked: ${blockReason}` : 'Gemini returned empty response.');
  }

  console.log('[aiService] Gemini responded as fallback.');
  return text;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Call the AI with a messages array (OpenAI format).
 * Tries Groq first; falls back to Gemini if all Groq models are quota-exhausted.
 *
 * @param {Array<{role: string, content: string}>} messages
 * @returns {Promise<string>} AI response text
 */
async function chat(messages) {
  try {
    return await callGroq(messages);
  } catch (err) {
    if (err.groqExhausted) {
      console.warn('[aiService] All Groq models exhausted — falling back to Gemini');
      return callGemini(messages);
    }
    throw err;
  }
}

module.exports = { chat };
