# Maritime Manning Agent — Document Extraction Service: Build Plan

## Overview

A production-oriented backend that allows maritime Manning Agents to upload seafarer certification documents (certificates, medical exams, passports, drug tests) and extract structured data automatically using a vision-capable LLM (Gemini 2.0 Flash).

---

## Technology Decisions

| Concern          | Choice                  | Rationale                                                                                                                             |
| ---------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime          | Node.js + TypeScript    | Strong typing, excellent ecosystem for file handling and HTTP APIs                                                                    |
| Framework        | Fastify                 | Faster than Express, built-in schema validation via JSON Schema / Zod, async-first                                                    |
| Database         | PostgreSQL              | Relational integrity for sessions/jobs/extractions, JSONB for flexible LLM output, native UUID support                                |
| ORM              | Drizzle ORM             | Type-safe, lightweight, SQL-first — avoids ActiveRecord bloat of Prisma for this use case                                             |
| Queue            | pg-boss                 | Uses the same PostgreSQL database — no extra infrastructure, persistent jobs, retry logic, exactly-once delivery, polling-table style |
| LLM Provider     | Configurable via env    | Abstracted behind a `LLMProvider` interface; Gemini 2.0 Flash as default implementation                                               |
| File Storage     | Local disk (temp)       | Files are held only during processing; SHA-256 hash stored in DB for deduplication. Can swap to S3 via env config later               |
| Containerization | Docker + docker-compose | PostgreSQL DB only, as specified                                                                                                      |

**Why pg-boss over BullMQ (Redis) or in-process queue?**

- No additional infrastructure (Redis not needed)
- Jobs survive server restarts
- Built-in retry, dead-letter, and scheduling
- Single dependency — the PostgreSQL DB we already have

---

## Project Structure

```
/
├── docker-compose.yml              # PostgreSQL only
├── .env.example
├── package.json
├── tsconfig.json
├── drizzle.config.ts
├── src/
│   ├── index.ts                    # App entry point
│   ├── app.ts                      # Fastify app factory
│   ├── config.ts                   # Env var validation (zod)
│   ├── db/
│   │   ├── client.ts               # Drizzle + pg pool
│   │   ├── schema.ts               # All table definitions
│   │   └── migrations/             # Drizzle migration files
│   ├── queue/
│   │   ├── boss.ts                 # pg-boss singleton
│   │   └── worker.ts               # Job handler — calls LLM, writes result
│   ├── llm/
│   │   ├── provider.interface.ts   # LLMProvider interface
│   │   ├── factory.ts              # Reads LLM_PROVIDER env, returns correct impl
│   │   ├── gemini.provider.ts      # Gemini 2.0 Flash implementation
│   │   └── prompt.ts               # Extraction prompt + validation prompt
│   ├── services/
│   │   ├── extraction.service.ts   # Core extraction logic (hash, dedupe, enqueue/sync)
│   │   ├── session.service.ts      # Session CRUD + health derivation
│   │   ├── validation.service.ts   # Cross-document compliance validation
│   │   └── report.service.ts       # Report assembly from DB data (no LLM call)
│   ├── routes/
│   │   ├── extract.route.ts        # POST /api/extract
│   │   ├── jobs.route.ts           # GET /api/jobs/:jobId
│   │   ├── sessions.route.ts       # GET /api/sessions/:sessionId
│   │   ├── validate.route.ts       # POST /api/sessions/:sessionId/validate
│   │   ├── report.route.ts         # GET /api/sessions/:sessionId/report
│   │   └── health.route.ts         # GET /api/health
│   ├── middleware/
│   │   ├── rateLimit.ts            # Token bucket per IP
│   │   └── errorHandler.ts         # Global error → standard error shape
│   └── utils/
│       ├── hash.ts                 # SHA-256 file hashing
│       ├── pdf.ts                  # PDF → image conversion (pdf2pic / pdftoppm)
│       └── dateUtils.ts            # Expiry calculations
└── tests/
    ├── extract.test.ts
    ├── session.test.ts
    └── validation.test.ts
```

---

## Database Schema

### `sessions`

| Column     | Type        | Notes              |
| ---------- | ----------- | ------------------ |
| id         | UUID PK     | Session identifier |
| created_at | TIMESTAMPTZ |                    |
| updated_at | TIMESTAMPTZ |                    |

### `extractions`

| Column             | Type        | Notes                                            |
| ------------------ | ----------- | ------------------------------------------------ |
| id                 | UUID PK     |                                                  |
| session_id         | UUID FK     | → sessions.id                                    |
| job_id             | UUID        | Null if sync mode                                |
| file_name          | TEXT        |                                                  |
| file_hash          | TEXT        | SHA-256; used for deduplication within session   |
| mime_type          | TEXT        |                                                  |
| document_type      | TEXT        | e.g. COC, PEME, PASSPORT                         |
| document_name      | TEXT        |                                                  |
| applicable_role    | TEXT        | DECK / ENGINE / BOTH / N/A                       |
| category           | TEXT        |                                                  |
| confidence         | TEXT        | HIGH / MEDIUM / LOW                              |
| holder_name        | TEXT        |                                                  |
| date_of_birth      | TEXT        |                                                  |
| sirb_number        | TEXT        |                                                  |
| passport_number    | TEXT        |                                                  |
| fields             | JSONB       | Array of {key, label, value, importance, status} |
| validity           | JSONB       |                                                  |
| compliance         | JSONB       |                                                  |
| medical_data       | JSONB       |                                                  |
| flags              | JSONB       | Array of {severity, message}                     |
| is_expired         | BOOLEAN     |                                                  |
| summary            | TEXT        |                                                  |
| raw_llm_response   | TEXT        | Stored on parse failure for debugging            |
| processing_time_ms | INTEGER     |                                                  |
| created_at         | TIMESTAMPTZ |                                                  |

### `jobs`

| Column         | Type        | Notes                                   |
| -------------- | ----------- | --------------------------------------- |
| id             | UUID PK     | jobId returned to client                |
| session_id     | UUID FK     | → sessions.id                           |
| status         | TEXT        | QUEUED / PROCESSING / COMPLETE / FAILED |
| extraction_id  | UUID        | Populated on COMPLETE                   |
| queue_position | INTEGER     |                                         |
| error_code     | TEXT        |                                         |
| error_message  | TEXT        |                                         |
| retryable      | BOOLEAN     |                                         |
| file_name      | TEXT        |                                         |
| file_path      | TEXT        | Temp path during processing             |
| mime_type      | TEXT        |                                         |
| file_hash      | TEXT        |                                         |
| started_at     | TIMESTAMPTZ |                                         |
| completed_at   | TIMESTAMPTZ |                                         |
| failed_at      | TIMESTAMPTZ |                                         |
| created_at     | TIMESTAMPTZ |                                         |

### `validations`

| Column             | Type        | Notes                             |
| ------------------ | ----------- | --------------------------------- |
| id                 | UUID PK     |                                   |
| session_id         | UUID FK     | → sessions.id                     |
| holder_profile     | JSONB       |                                   |
| consistency_checks | JSONB       |                                   |
| missing_documents  | JSONB       |                                   |
| expiring_documents | JSONB       |                                   |
| medical_flags      | JSONB       |                                   |
| overall_status     | TEXT        | APPROVED / CONDITIONAL / REJECTED |
| overall_score      | INTEGER     | 0–100                             |
| summary            | TEXT        |                                   |
| recommendations    | JSONB       | string[]                          |
| validated_at       | TIMESTAMPTZ |                                   |

---

## Endpoint Implementation Plan

### POST /api/extract

**Flow:**

1. Validate MIME type and file size (400 / 413 on failure)
2. Read `sessionId` from body — create session if absent
3. Compute SHA-256 hash of file buffer
4. Check `extractions` table for existing `(session_id, file_hash)` match → return with `X-Deduplicated: true` if found
5. If `?mode=async`:
   - Write a `jobs` row with status `QUEUED`
   - Save file to temp path
   - Enqueue pg-boss job `{ jobId, filePath, sessionId, fileName, mimeType, fileHash }`
   - Return `202` with `{ jobId, sessionId, status: "QUEUED", pollUrl, estimatedWaitMs }`
6. If `?mode=sync` (default):
   - Run extraction inline (call `ExtractionService.run()`)
   - Return `200` with full extraction result

**PDF handling:** PDFs are converted to images (one per page) before sending to Gemini, as the vision API accepts images. For multi-page PDFs, all pages are sent; the LLM is instructed to treat them as a single document.

**LLM call with retry:** If the LLM returns unparseable JSON, retry once. On second failure, store raw response and return `422 LLM_JSON_PARSE_FAIL`.

---

### GET /api/jobs/:jobId

- Look up `jobs` row by id
- Return `404 JOB_NOT_FOUND` if missing
- Map status to response shape:
  - `QUEUED` / `PROCESSING`: return queue position + estimated wait
  - `COMPLETE`: join extraction record, return full result
  - `FAILED`: return error code, message, retryable flag

---

### GET /api/sessions/:sessionId

- Validate session exists → `404 SESSION_NOT_FOUND`
- Fetch all extractions for session
- Derive `detectedRole` (majority vote on `applicable_role`)
- Derive `overallHealth`:
  - `CRITICAL` — any CRITICAL flag or expired required cert
  - `WARN` — any MEDIUM/HIGH flag or cert expiring within 90 days
  - `OK` — otherwise
- Fetch pending jobs for session
- Return shaped response

---

### POST /api/sessions/:sessionId/validate

- Validate session exists; fetch all extractions
- Require ≥ 2 documents → `400 INSUFFICIENT_DOCUMENTS`
- Assemble LLM validation prompt (see Validation Prompt Design below)
- Call LLM with full extraction data
- Parse response, persist to `validations` table
- Return structured compliance result

**Validation Prompt Design:**

The prompt will:

1. Present the LLM with the holder's full name, role, and all document summaries in JSON
2. Ask it to: verify identity consistency across documents, check required STCW certifications for the detected role, flag expiring/expired documents, assess medical fitness, and produce an overall APPROVED / CONDITIONAL / REJECTED decision with a 0–100 score
3. Instruct it to return structured JSON matching the response schema

---

### GET /api/sessions/:sessionId/report

No LLM call. Assembled purely from DB data.

**Report schema (designed for Manning Agent decision-making):**

```json
{
  "reportId": "uuid",
  "sessionId": "uuid",
  "generatedAt": "ISO datetime",
  "holderSummary": {
    "fullName": "string",
    "dateOfBirth": "string",
    "nationality": "string",
    "sirbNumber": "string",
    "passportNumber": "string",
    "rank": "string",
    "detectedRole": "DECK | ENGINE | BOTH | N/A"
  },
  "overallVerdict": {
    "status": "APPROVED | CONDITIONAL | REJECTED | PENDING_VALIDATION",
    "score": 74,
    "health": "OK | WARN | CRITICAL",
    "summary": "plain English one-paragraph summary"
  },
  "documentChecklist": [
    {
      "documentType": "COC",
      "documentName": "Certificate of Competency",
      "status": "PRESENT | MISSING | EXPIRED | EXPIRING_SOON",
      "fileName": "string or null",
      "issuingAuthority": "string or null",
      "expiryDate": "string or null",
      "daysUntilExpiry": 120,
      "flags": []
    }
  ],
  "medicalSummary": {
    "fitnessResult": "FIT | UNFIT | N/A",
    "drugTestResult": "NEGATIVE | POSITIVE | N/A",
    "pemeExpiry": "string or null",
    "restrictions": "string or null",
    "specialNotes": "string or null"
  },
  "complianceIssues": [
    {
      "severity": "CRITICAL | HIGH | MEDIUM | LOW",
      "source": "documentType or 'CROSS_DOCUMENT'",
      "message": "string",
      "recommendation": "string"
    }
  ],
  "expiringDocuments": [
    {
      "documentType": "string",
      "fileName": "string",
      "expiryDate": "string",
      "daysUntilExpiry": 45
    }
  ],
  "missingDocuments": ["COC", "PEME"],
  "recommendations": ["string"],
  "validationResult": { "...last validation record or null..." }
}
```

---

### GET /api/health

- Ping DB with `SELECT 1`
- Check pg-boss is initialized
- Optionally ping LLM provider with a no-op or cached check
- Return `{ status, version, uptime, dependencies, timestamp }`

---

## LLM Provider Abstraction

```typescript
interface LLMProvider {
  extractDocument(
    fileBuffer: Buffer,
    mimeType: string,
    prompt: string,
  ): Promise<string>; // returns raw JSON string
}
```

Factory reads `LLM_PROVIDER` env var:

- `gemini` → `GeminiProvider` (default)
- Additional providers (openai, anthropic) can be added without touching business logic

Env vars:

```
LLM_PROVIDER=gemini
LLM_MODEL=gemini-2.0-flash
LLM_API_KEY=...
```

---

## Rate Limiting

- Per-IP token bucket: 20 requests/minute for `/api/extract`, 60/minute for other endpoints
- Implemented via `@fastify/rate-limit`
- Returns `429 RATE_LIMITED` with `retryAfterMs`

---

## Error Handling

All errors normalized to:

```json
{
  "error": "ERROR_CODE",
  "message": "Human-readable description",
  "extractionId": "uuid or null",
  "retryAfterMs": "number or null"
}
```

Global Fastify `setErrorHandler` catches unhandled errors and maps them to `500 INTERNAL_ERROR`.

---

## Environment Variables

```env
# Server
PORT=3000
NODE_ENV=development

# Database
DATABASE_URL=postgresql://user:password@localhost:5432/maritime_docs

# LLM
LLM_PROVIDER=gemini
LLM_MODEL=gemini-2.0-flash
LLM_API_KEY=your_api_key_here

# File handling
MAX_FILE_SIZE_MB=10
TEMP_UPLOAD_DIR=/tmp/maritime-uploads

# Queue (pg-boss uses DATABASE_URL)
JOB_CONCURRENCY=3

# Rate limiting
RATE_LIMIT_EXTRACT_RPM=20
RATE_LIMIT_GENERAL_RPM=60
```

---

## Build & Run Order

1. `docker-compose up -d` — start PostgreSQL
2. `npm install`
3. `npm run db:migrate` — run Drizzle migrations
4. `npm run dev` — start dev server with ts-node / tsx watch

---

## Implementation Phases

---

### Phase 1 — Foundation

**Goal:** Runnable project skeleton with database connectivity and config validation.

**Files to create:**

- `package.json` — dependencies: fastify, @fastify/multipart, @fastify/rate-limit, drizzle-orm, pg, pg-boss, @google/generative-ai, pdf2pic, zod, uuid
- `tsconfig.json` — strict mode, ESNext module, `outDir: dist`
- `docker-compose.yml` — PostgreSQL 16 service only, port 5432, named volume
- `drizzle.config.ts` — points at `src/db/schema.ts`, outputs migrations to `src/db/migrations/`
- `src/config.ts` — Zod schema parsing all env vars; throws on startup if any required var is missing
- `src/db/schema.ts` — Drizzle table definitions for `sessions`, `extractions`, `jobs`, `validations`
- `src/db/client.ts` — `pg.Pool` singleton, Drizzle instance exported
- `src/db/migrations/` — initial migration generated via `drizzle-kit generate`
- `src/index.ts` — starts server, runs DB migration check on boot

**Acceptance criteria:**

- `docker-compose up -d && npm run dev` starts without errors
- `GET /api/health` returns `200` with `database: "OK"`
- All 4 tables exist in PostgreSQL after `npm run db:migrate`

---

### Phase 2 — LLM Layer

**Goal:** Pluggable LLM abstraction with a working Gemini implementation and all file-handling utilities.

**Files to create:**

- `src/llm/provider.interface.ts` — `LLMProvider` interface with `extractDocument(buffer, mimeType, prompt): Promise<string>`
- `src/llm/gemini.provider.ts` — `GeminiProvider` implementing the interface; sends image/PDF buffer to Gemini vision API using `@google/generative-ai`; handles base64 encoding
- `src/llm/factory.ts` — reads `LLM_PROVIDER` env var, returns the correct `LLMProvider` instance; throws `INTERNAL_ERROR` for unknown providers
- `src/llm/prompt.ts` — exports `EXTRACTION_PROMPT` (the exact prompt from spec) and `buildValidationPrompt(extractions[])` (custom design)
- `src/utils/hash.ts` — `computeSHA256(buffer: Buffer): string`
- `src/utils/pdf.ts` — `pdfToImages(buffer: Buffer): Promise<Buffer[]>` using `pdf2pic`; returns one Buffer per page as PNG
- `src/utils/dateUtils.ts` — `daysUntilExpiry(dateStr: string): number | null`, `isExpired(dateStr: string): boolean`

**Acceptance criteria:**

- Calling `GeminiProvider.extractDocument()` with a test image returns a raw JSON string
- `pdfToImages()` returns at least one PNG buffer for a single-page PDF
- `LLMFactory` throws on unknown `LLM_PROVIDER` value

---

### Phase 3 — Core Extraction Service

**Goal:** End-to-end document processing pipeline: receive file → hash → deduplicate → call LLM → parse → persist.

**Files to create:**

- `src/services/extraction.service.ts`
  - `run(params: ExtractionParams): Promise<ExtractionRecord>` — full pipeline
  - Step 1: compute SHA-256 hash
  - Step 2: query `extractions` for `(session_id, file_hash)` match → return early with `isDuplicate: true`
  - Step 3: convert PDF to images if needed; send to LLM with `EXTRACTION_PROMPT`
  - Step 4: parse LLM JSON response; on failure retry once; on second failure insert failed `extractions` row with `raw_llm_response` and throw `LLM_JSON_PARSE_FAIL`
  - Step 5: compute `isExpired`, `daysUntilExpiry` from parsed validity dates
  - Step 6: insert into `extractions` table; return full record with `processingTimeMs`
- `src/services/session.service.ts`
  - `createSession(): Promise<Session>`
  - `getSession(id): Promise<Session | null>`
  - `getSessionWithExtractions(id): Promise<SessionDetail>` — includes derived `detectedRole` and `overallHealth`
  - `deriveHealth(extractions[]): "OK" | "WARN" | "CRITICAL"`
  - `deriveRole(extractions[]): "DECK" | "ENGINE" | "BOTH" | "N/A"`

**Acceptance criteria:**

- `ExtractionService.run()` with a real image returns a fully populated `ExtractionRecord`
- Calling it twice with the same file+session returns the cached record on the second call
- LLM parse failure after 2 attempts inserts a row with `raw_llm_response` populated

---

### Phase 4 — Queue

**Goal:** Async job processing via pg-boss; job lifecycle fully tracked in the `jobs` table.

**Files to create:**

- `src/queue/boss.ts` — `PgBoss` singleton; `initBoss(): Promise<PgBoss>`; exports `getBoss()`
- `src/queue/worker.ts`
  - Registers a worker for queue name `"document-extraction"`
  - On receive: update `jobs` row to `PROCESSING`, record `started_at`
  - Call `ExtractionService.run()`
  - On success: update `jobs` to `COMPLETE`, set `extraction_id` and `completed_at`
  - On failure: update `jobs` to `FAILED`, set `error_code`, `error_message`, `retryable`, `failed_at`
  - Clean up temp file after processing regardless of outcome
- `src/queue/boss.ts` also exports `enqueueExtractionJob(payload): Promise<string>` — inserts `jobs` row + sends to pg-boss, returns `jobId`

**Queue configuration:**

- Concurrency: `JOB_CONCURRENCY` env var (default 3)
- Retry: 1 automatic retry on failure (pg-boss `retryLimit: 1`)
- Retention: completed jobs kept 24h, failed jobs kept 7 days

**Acceptance criteria:**

- Enqueuing a job returns a `jobId`; polling `GET /api/jobs/:jobId` shows `QUEUED` → `PROCESSING` → `COMPLETE`
- If the worker throws, job transitions to `FAILED` with `retryable: true`
- Temp file is deleted after job completes or fails

---

### Phase 5 — Routes

**Goal:** All six endpoints implemented, wired to services, returning spec-compliant response shapes.

**Files to create:**

**`src/routes/extract.route.ts`** — `POST /api/extract`

- Parse multipart body (`@fastify/multipart`): `document` field + optional `sessionId`
- Validate MIME (`image/jpeg`, `image/png`, `application/pdf`) → `400 UNSUPPORTED_FORMAT`
- Validate size ≤ 10MB → `413 FILE_TOO_LARGE`
- Create session if `sessionId` absent
- Validate session exists if provided → `404 SESSION_NOT_FOUND`
- `?mode=async`: save file to temp dir, call `enqueueExtractionJob()`, return `202`
- `?mode=sync` (default): call `ExtractionService.run()` inline, return `200`
- Set `X-Deduplicated: true` header when dedup triggered

**`src/routes/jobs.route.ts`** — `GET /api/jobs/:jobId`

- Look up `jobs` row → `404 JOB_NOT_FOUND` if missing
- Shape response based on status (`QUEUED`/`PROCESSING`/`COMPLETE`/`FAILED`)
- When `COMPLETE`: join and embed `extractions` record as `result`

**`src/routes/sessions.route.ts`** — `GET /api/sessions/:sessionId`

- Validate session → `404 SESSION_NOT_FOUND`
- Fetch extractions + pending jobs
- Return with derived `detectedRole` and `overallHealth`

**`src/routes/validate.route.ts`** — `POST /api/sessions/:sessionId/validate`

- Validate session → `404`
- Count extractions → `400 INSUFFICIENT_DOCUMENTS` if < 2
- Build validation prompt, call LLM, parse, persist to `validations`
- Return full validation result

**`src/routes/report.route.ts`** — `GET /api/sessions/:sessionId/report`

- Validate session → `404`
- Fetch extractions + most recent validation (if any)
- Assemble report from DB data only — no LLM call
- Return full report per schema defined in Endpoint Specifications

**`src/routes/health.route.ts`** — `GET /api/health`

- Ping DB with `SELECT 1`
- Check pg-boss is initialized
- Return `{ status, version, uptime, dependencies, timestamp }`

**Acceptance criteria:**

- All 6 endpoints return correct status codes and shapes per spec
- Deduplication header present on repeated upload
- `?mode=async` returns `202` with `pollUrl`; polling eventually returns `COMPLETE` result

---

### Phase 6 — Middleware & Polish

**Goal:** Production-grade cross-cutting concerns: rate limiting, error normalization, logging, file cleanup.

**Files to create / update:**

- `src/middleware/errorHandler.ts`
  - Global Fastify `setErrorHandler`
  - Maps known error codes (custom `AppError` class) to correct HTTP status
  - Maps unknown errors to `500 INTERNAL_ERROR`
  - Always returns `{ error, message, extractionId, retryAfterMs }` shape
- `src/middleware/rateLimit.ts`
  - `@fastify/rate-limit` plugin registration
  - `/api/extract`: 20 req/min per IP
  - All other routes: 60 req/min per IP
  - Returns `429 RATE_LIMITED` with `retryAfterMs`
- `src/app.ts` (update)
  - Register `@fastify/multipart` with `limits: { fileSize: 10 * 1024 * 1024 }`
  - Register error handler and rate limit middleware
  - Register all routes under `/api` prefix
  - Add `pino` request logging (built into Fastify)
- Temp file cleanup: ensure `fs.unlink()` runs in `finally` blocks for sync mode too

**Acceptance criteria:**

- 21st request to `/api/extract` within a minute returns `429`
- Any unhandled thrown error returns the standard error JSON shape with `500`
- No temp files left on disk after sync or async processing

---

### Phase 7 — Testing

**Goal:** Confidence in correctness via unit and integration tests with no real LLM calls.

**Files to create:**

- `tests/mocks/llm.mock.ts` — `MockLLMProvider` implementing `LLMProvider`; returns fixture JSON responses keyed by document type
- `tests/fixtures/` — sample LLM response JSONs for COC, PEME, PASSPORT, DRUG_TEST
- `tests/unit/extraction.service.test.ts`
  - Deduplication returns cached record
  - LLM parse failure after 2 attempts throws `LLM_JSON_PARSE_FAIL` and stores raw response
  - `isExpired` and `daysUntilExpiry` computed correctly
- `tests/unit/session.service.test.ts`
  - `deriveHealth()` returns `CRITICAL` for expired required cert
  - `deriveHealth()` returns `WARN` for cert expiring in 45 days
  - `deriveRole()` majority-votes correctly
- `tests/unit/report.service.test.ts`
  - Report assembled correctly from fixture extraction + validation data
  - `PENDING_VALIDATION` status when no validation record exists
- `tests/integration/routes.test.ts`
  - `POST /api/extract?mode=sync` with JPEG fixture → `200` with correct shape
  - `POST /api/extract` with oversized file → `413`
  - `POST /api/extract` with unsupported type → `400`
  - Duplicate upload → `200` with `X-Deduplicated: true`
  - `GET /api/jobs/:jobId` with unknown id → `404`
  - `POST /api/sessions/:sessionId/validate` with 1 document → `400 INSUFFICIENT_DOCUMENTS`
  - `GET /api/health` → `200` with all dependencies `OK`

**Test tooling:**

- Vitest (fast, ESM-native)
- Separate test PostgreSQL database (spun up via `docker-compose` in CI)
- DB reset between integration test suites via `drizzle-kit push --force`

---

## Key Design Decisions & Tradeoffs

| Decision                                | Rationale                                                                                                                                         |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| pg-boss over BullMQ                     | Single infrastructure dependency (Postgres already required); jobs are durable across restarts; no Redis ops overhead                             |
| Drizzle over Prisma                     | SQL-first, smaller bundle, no Prisma Engine binary; better for JSONB column handling                                                              |
| Fastify over Express                    | 2–3× throughput; built-in JSON schema validation; async-native                                                                                    |
| JSONB for `fields`, `validity`, etc.    | LLM output schema evolves with document types; rigid columns would require migrations for every new document type                                 |
| SHA-256 deduplication scoped to session | Prevents redundant LLM calls for identical files; session-scoped avoids cross-tenant data leakage                                                 |
| Temp file + cleanup                     | Files are not stored permanently; only extracted data is persisted — reduces storage requirements and avoids PII retention concerns               |
| Sync mode default                       | For small files (most certs are single-page JPEGs/PDFs), blocking is acceptable and simpler for clients; async provided for large/batch scenarios |
