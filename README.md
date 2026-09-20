# CrackJAMB Backend

Express + PostgreSQL API for the MalamAI / CrackJAMB study app. Handles auth, question banks, quizzes, admin tools, and the **server-side AI proxy** (Groq → Gemini).

## Requirements

- Node.js 18+
- PostgreSQL 14+
- A Groq API key (required for AI). Gemini is optional fallback.

## Quick start

```bash
cd backend
cp .env.example .env
# Edit .env — see Environment below
npm install
npm run dev
```

Server listens on `http://localhost:5000` by default.

Health check:

```bash
curl http://localhost:5000/api/health
```

On boot, `server.js` runs migrations (creates tables, seeds subjects, seeds admin) then starts listening.

Production start:

```bash
npm start
```

From the monorepo root:

```bash
npm run backend        # nodemon (dev)
npm run backend:start  # node server.js
```

## Environment

Copy `.env.example` → `.env` and fill in at least:

| Variable | Purpose |
|---|---|
| `JWT_SECRET` | Signing secret (≥ 32 chars; not a placeholder) |
| `DATABASE_URL` **or** `DB_HOST` / `DB_PORT` / `DB_NAME` / `DB_USER` / `DB_PASSWORD` | Postgres |
| `PORT` | Default `5000` |
| `GROQ_API_KEY` | Primary AI provider |
| `GROQ_API_URL` | Default Groq chat-completions URL |
| `GEMINI_API_KEY` / `GEMINI_API_URL` | Optional fallback when Groq returns 429 |
| `AI_DAILY_CHAT_LIMIT` | Per-user daily chat messages (default 30) |
| `AI_DAILY_GENERATE_LIMIT` | Per-user daily generate calls (default 20) |
| `AI_CACHE_TTL_DAYS` | Shared prompt cache TTL (default 7) |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | Seeded admin (required in production) |

**Never put Groq/Gemini keys in the Expo app.** AI keys stay on this server only.

## Project layout

```
backend/
  server.js              Boot: env checks → migrate → listen
  src/
    app.js               Express app + route mounts
    config/database.js   Postgres pool
    db/migrate.js        Schema, backfills, seeds
    middleware/          auth, adminOnly
    controllers/
    routes/              auth, questions, quiz, ai, admin, …
    services/aiService.js  Groq model chain + Gemini fallback
  .env.example
```

## API overview

All student/admin JSON routes are under `/api`.

| Prefix | Role |
|---|---|
| `/api/health` | Liveness + DB ping |
| `/api/auth` | Register, login, verify, password reset |
| `/api/subjects` | Subject list |
| `/api/questions` | Practice bank (answers hidden until grade) |
| `/api/quiz` | Attempts + server-side grading |
| `/api/past-exams` | Past JAMB papers |
| `/api/ai` | Chat, generate, usage, study plan, conversations |
| `/api/admin` | Users, content, audit (admin JWT) |
| `/api/profile`, `/notes`, `/bookmarks`, `/notifications`, `/leaderboard`, `/mock-exams` | Student features |

Protected routes expect:

```http
Authorization: Bearer <jwt>
```

## AI implementation

### Why server-side?

The Expo client never talks to Groq/Gemini directly. That keeps API keys off the phone, enforces daily quotas in Postgres, and shares a prompt cache across users.

```
Phone / Expo  →  POST /api/ai/* (JWT)  →  ai.js  →  aiService.js  →  Groq (then Gemini)
```

### Provider logic (`src/services/aiService.js`)

1. Try Groq models in order (`GROQ_PRIMARY_MODEL` or `llama-3.3-70b-versatile`, then smaller fallbacks).
2. If all Groq models return 429, call Gemini (if configured).
3. Return plain text to the route layer.

### Routes (`src/routes/ai.js`)

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/ai/chat` | Multi-turn tutor chat (daily chat quota) |
| `POST` | `/api/ai/generate` | Typed generation: `explanation`, `questions`, `flashcards`, `step_by_step`, `why_wrong` |
| `GET` | `/api/ai/usage` | Today’s chat/generate used/limit/remaining |
| `POST` | `/api/ai/study-plan` | One-day JSON study plan (cached per user/day) |
| `GET/POST/PATCH/DELETE` | `/api/ai/conversations…` | Optional chat thread persistence |

Also related:

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/questions/save-ai` | **Admin only** — persist AI MCQs into the bank (`is_ai=true`, `is_ai_reviewed=false`) |

### Content integrity

- Student `GET /api/questions` returns banked items that are **not AI**, or AI items that are **reviewed** (`is_ai_reviewed=true`).
- Unreviewed AI questions never appear in student practice pulls.
- Generated quiz items used in a student session stay client-side unless an admin saves them via `save-ai`.

### Tables (created by migrate)

- `ai_usage` — per-user daily chat/generate counters  
- `ai_cache` — prompt-hash → response  
- `ai_conversations` / `ai_messages` — optional chat history  
- `questions.is_ai`, `questions.is_ai_reviewed`

### Smoke test (logged-in)

```bash
# 1) Login
TOKEN=$(curl -s -X POST http://localhost:5000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"you@example.com","password":"your-password"}' | jq -r .token)

# 2) Usage
curl -s http://localhost:5000/api/ai/usage -H "Authorization: Bearer $TOKEN" | jq

# 3) Chat
curl -s -X POST http://localhost:5000/api/ai/chat \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"messages":[{"role":"user","content":"Explain osmosis simply"}]}' | jq

# 4) Generate flashcards
curl -s -X POST http://localhost:5000/api/ai/generate \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"type":"flashcards","subject":"Biology","topic":"Osmosis"}' | jq
```

## Admin seed (dev)

If `ADMIN_EMAIL` / `ADMIN_PASSWORD` are unset in development, migrate may seed:

- Email: `admin@crackjamb.local`
- Password: `Admin12345`

Change these before any shared or production deploy.

## Common issues

| Symptom | Fix |
|---|---|
| `Missing JWT_SECRET` / DB vars | Copy `.env.example` and fill values |
| `ECONNREFUSED` Postgres | Start Postgres; match `DB_*` / `DATABASE_URL` |
| AI 500 / “GROQ_API_KEY is not configured” | Set `GROQ_API_KEY` in `.env` and restart |
| AI 429 daily limit | Wait for midnight reset, or raise `AI_DAILY_*` in `.env` |
| Phone cannot reach API | Bind is fine; client must use LAN IP (see frontend README) |
