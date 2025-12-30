# Backend Architecture (Diagram-Friendly)

This document describes the backend architecture in a way that’s easy to convert into an Excalidraw diagram (boxes + arrows + flows).

## What This Backend Does

- Provides a simple chat API for a support assistant.
- Persists visitors, conversations, and messages in Postgres.
- Generates AI replies via Gemini.
- Uses Redis for:
  - rate limiting
  - low-context response caching
  - pub/sub fan-out for SSE updates
- Supports both:
  - synchronous replies (`POST /chat/message`)
  - asynchronous replies via queue/worker (`async: true` + `GET /chat/job/:jobId` + `GET /chat/subscribe`)

---

## Runtime Components (Boxes)

### Client(s)

- Browser UI (Svelte frontend)
- Postman / curl
- SSE client (browser `EventSource`)

### Backend API (Express)

- Container: `backend` (port `8080`)
- Entrypoint: `src/index.ts` → `src/app.ts`
- Responsibilities:
  - Request validation (Zod)
  - Visitor identification (`x-visitor-id` header and/or cookie)
  - Rate limiting
  - Persistence + orchestration (via services)
  - Optional enqueue for async generation
  - SSE subscription endpoint

### Worker (BullMQ Worker)

- Container: `worker`
- Entrypoint: `src/worker.ts`
- Responsibilities:
  - Consume jobs from Redis queue (`chat-reply`)
  - Generate AI replies (Gemini)
  - Persist AI messages to Postgres
  - Publish updates over Redis pub/sub (`conversation:<sessionId>`)

### Redis

- Container: `redis` (port `6379`)
- Responsibilities:
  - Fixed-window counters for rate limiting
  - Cache entries (`cache:reply:*`)
  - BullMQ queue storage (jobs)
  - Pub/sub for SSE broadcasting

### Postgres

- Container: `postgres` (port `5432`)
- Responsibilities:
  - System of record for Visitors / Conversations / Messages / FAQ

### External: Gemini API

- Called by API and Worker
- Module: `src/llm/gemini.ts`

---

## Data Model (Database Boxes)

Tables (via Prisma schema):

- `Visitor`
  - `externalId` (what the client uses; sourced from `x-visitor-id` header or cookie)
- `Conversation`
  - belongs to a `Visitor`
  - used as `sessionId` across API requests
  - `lastMessageAt` used to keep a small set of “active” conversations
- `Message`
  - belongs to a `Conversation`
  - `sender`: `user | ai | system`
  - `clientMessageId` (optional idempotency key per conversation)
- `FaqEntry`
  - seeded store policies used as context for the assistant

---

## Request/Response Surface (API Edge)

Mounted routes: `src/app.ts` mounts `src/routes/chatRoutes.ts` at `/chat`.

Endpoints:

- `GET /health`
  - Returns `{ ok: true }`

- `POST /chat/message`
  - Body: `{ message: string, sessionId?: string, clientMessageId?: string, async?: boolean }`
  - Sync response: `{ reply: string, sessionId: string }`
  - Async response (when `async: true`): `{ sessionId: string, status: "queued", jobId: string }`

- `GET /chat/history?sessionId=...`
  - Response: `{ messages: Message[] }`

- `GET /chat/job/:jobId`
  - Response: `{ jobId: string, state: string }`

- `GET /chat/subscribe?sessionId=...` (SSE)
  - Sends:
    - `event: ready` with `{ sessionId }`
    - `event: update` with `{ type, conversationId, reply, fromCache }` when worker publishes

---

## Cross-Cutting Middleware

### Visitor Context (`src/middleware/visitor.ts`)

- Input sources:
  - `x-visitor-id` request header (preferred)
  - `vid` cookie (fallback; helps SSE clients that cannot set custom headers)
- Output:
  - attaches `req.visitor.visitorId`
  - sets response header `x-visitor-id`
  - sets cookie `vid` (httpOnly, sameSite=lax)

### Rate Limiting (`src/middleware/rateLimit.ts`)

- Redis fixed-window counters per minute:
  - per visitor: `rl:visitor:<visitorId>:m`
  - per IP: `rl:ip:<ip>:m`
- If Redis is down: fails open (does not block requests).

---

## Key Flows (Sequence-Friendly)

### 1) Synchronous Chat Message (`POST /chat/message`)

**Goal:** client sends a user message and gets an AI reply immediately.

Flow:

1. Client → API: `POST /chat/message` with `message`, optional `sessionId`, optional `clientMessageId`.
2. API → Middleware: resolve `visitorId` (header/cookie) and apply rate limits.
3. API → Postgres (via Prisma):
   - upsert visitor (by `externalId`)
   - create or reuse conversation (by `sessionId`, otherwise reuse recent active, otherwise create)
   - insert user `Message` (idempotent via `(conversationId, clientMessageId)` unique constraint)
4. API → Redis (optional):
   - if “low-context” (short history): try cached reply by key `cache:reply:<model>:<faqHash>:<msgHash>`
5. If cache hit:
   - API → Postgres: persist AI `Message`
   - API → Client: return `{ reply, sessionId }`
6. If cache miss:
   - API → Gemini API: generate reply using `systemInstruction + FAQ + recent history`
   - API → Redis: store reply (best-effort)
   - API → Postgres: persist AI `Message`
   - API → Client: return `{ reply, sessionId }`

Notes:

- Messages are clamped to 2000 characters; if truncated, the stored/returned reply includes a truncation note.

### 2) Asynchronous Chat Message (Queue + Worker)

**Goal:** client sends message quickly; AI work happens in background.

Flow:

1. Client → API: `POST /chat/message` with `async: true`.
2. API → Postgres: persist user message (same as sync, but no Gemini call here).
3. API → Redis/BullMQ: enqueue job `chat-reply` with `{ conversationId, userMessage, truncated }`.
4. API → Client: return `{ status: "queued", jobId, sessionId }`.
5. Worker → Redis/BullMQ: consumes job.
6. Worker → Redis (optional): tries cache (same logic as sync).
7. Worker → Gemini API (if needed): generates reply.
8. Worker → Postgres: persists AI `Message`.
9. Worker → Redis Pub/Sub: publish on `conversation:<sessionId>`.

### 3) Live Updates via SSE (`GET /chat/subscribe`)

**Goal:** client receives AI replies as server-pushed events.

Flow:

1. Client → API: `GET /chat/subscribe?sessionId=...`.
2. API:
   - validates `sessionId`
   - checks that the conversation belongs to the current visitor (via Postgres lookup)
3. API → Client: opens `text/event-stream` and sends `event: ready`.
4. API → Redis: subscribes to pub/sub channel `conversation:<sessionId>`.
5. Worker → Redis: publishes `event payload`.
6. API → Client: forwards as `event: update` SSE frames.

Important:

- SSE clients often cannot attach custom headers; the visitor cookie (`vid`) is what makes this work reliably.

---

## Caching Strategy (Diagram Notes)

Cache is intentionally limited to avoid serving context-sensitive answers incorrectly:

- Only used when conversation history is very short (≤ 2 turns in prompt history).
- Key includes model + FAQ hash + normalized message hash.
- TTL: `CACHE_TTL_SECONDS`.

---

## Diagram “Boxes & Arrows” Cheat Sheet (Copy into Excalidraw)

### Boxes to Draw

- Client (Browser / Postman)
- Backend API (Express)
  - Middleware: Visitor
  - Middleware: Rate Limit
  - Controller: Chat
  - Service: ChatService
  - LLM client: Gemini
- Worker (BullMQ Worker)
  - Service: ChatService
  - LLM client: Gemini
- Redis
  - Rate limit keys
  - Cache keys
  - Queue storage (BullMQ)
  - Pub/Sub channels
- Postgres
  - Visitor
  - Conversation
  - Message
  - FaqEntry
- External: Gemini API

### Arrows to Draw (Core)

- Client → Backend API: HTTP
- Backend API → Postgres: Prisma (writes/reads)
- Backend API → Redis: rate limit + cache + enqueue
- Backend API → Gemini API: (sync generation path)
- Worker → Redis: consume queue + cache + publish
- Worker → Postgres: persist AI message
- Worker → Gemini API: (async generation)
- Backend API ↔ Client: SSE stream
- Backend API ↔ Redis: pub/sub subscribe

---

## Code Map (Where to Look)

- App bootstrap: `src/index.ts`, `src/app.ts`
- Routes: `src/routes/chatRoutes.ts`
- Controllers: `src/controllers/chatController.ts`
- Validation schemas: `src/models/chatSchemas.ts`
- Core logic: `src/services/chatService.ts`
- FAQ context: `src/services/faqService.ts`
- Visitor middleware: `src/middleware/visitor.ts`
- Rate limiting: `src/middleware/rateLimit.ts`
- Redis client: `src/infra/redis.ts`
- Queue: `src/infra/queue.ts`
- Worker: `src/worker.ts`
- Prisma client/adapter: `src/db/prisma.ts`
- LLM client: `src/llm/gemini.ts`

---

## Deployment Notes (Docker Compose)

In `docker-compose.yml`:

- `backend` exposes port `8080:8080` and mounts `./backend:/app`.
- `worker` runs the same built image as the backend but uses command `npm run worker:dev`.
- `postgres` and `redis` run as sibling containers on the compose network.

Key env vars (see `src/config/env.ts`):

- `DATABASE_URL`, `REDIS_URL`
- `GEMINI_API_KEY`, `GEMINI_MODEL`
- `RATE_LIMIT_VISITOR_PER_MINUTE`, `RATE_LIMIT_IP_PER_MINUTE`
- `CACHE_TTL_SECONDS`
- `MAX_ACTIVE_CONVERSATIONS`, `ACTIVE_CONVERSATION_TTL_MINUTES`
