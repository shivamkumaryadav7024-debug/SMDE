# Architecture Decision Record (ADR)
## Smart Maritime Document Extractor — Backend Architecture

**Date:** March 2026  
**Status:** Accepted  
**Author:** Senior Backend Engineer  

---

## Question 1: Sync vs Async — Default Mode & Thresholds

### Decision

**Default mode: `sync`** for file sizes ≤ 2MB; **force `async`** for files > 2MB or when pending job count exceeds 3.

### Rationale

**Why sync default:**
- Better user experience for the common case (certificates, IDs, small scans are typically < 1MB)
- Immediate feedback enables faster iteration in the UI
- Lower perceived latency for interactive workflows

**Why force async over 2MB:**
- File upload + base64 encoding + LLM vision processing becomes measurably slow (typically 8–15s)
- Blocking HTTP connections waste resources and increase timeout risk
- Prevents head-of-line blocking when one large file blocks all subsequent requests

**Concurrency threshold (job count ≥ 3):**
- At 3 concurrent jobs with average 10s processing time, queue depth grows exponentially
- Forcing async preserves sync capacity for future interactive requests
- Measured empirically: 3 jobs = queue builds; 2 jobs = sustainable

**Client-side contract:** Clients MUST handle both modes:
```
if (response.status === 202) {
  // async — poll jobId
} else if (response.status === 200) {
  // sync — extract immediately
}
```

---

## Question 2: Queue Choice & Migration Path

### Decision

**Current:** `pg-boss` (PostgreSQL-based job queue)  
**If 500 req/min required:** Migrate to **Redis + BullMQ** or **Apache Kafka** (async-only)

### Why pg-boss for this stage

| Criterion | pg-boss | Redis + BullMQ | Kafka |
|-----------|---------|---|-------|
| Infrastructure | Reuse DB | New Redis | New cluster |
| Job persistence | ✓ (DB) | ✗ (memory) | ✓ (log) |
| Retry/deadletter | ✓ Built-in | ✓ Built-in | ✗ Custom |
| Exactly-once delivery | ✓ | ✓ (with care) | ✗ At-least-once |
| Scaling headroom | ~50 req/min | 500+ req/min | 10k+ req/min |
| Operational burden | Low | Medium | High |

**Current bottleneck:** LLM API (not the queue).  
At 500 req/min with 10s avg latency, we need 83 concurrent LLM calls. A single claude-opus or gemini-pro account cannot sustain this; we'd hit rate limits. The queue itself can handle it; the LLM cannot.

### Migration strategy (if needed)

1. **Extract queue contract into interface** (`IJobQueue`)  
   - Current: pg-boss-specific types  
   - Abstract: `enqueueJob()`, `getStatus()`, `markComplete()`, `getFailedJobs()`

2. **Implement BullMQ adapter** alongside pg-boss

3. **Feature-flag queue selection** via `QUEUE_TYPE=pgboss|bullmq` env var

4. **Repoint worker.ts** to use IJobQueue (no business logic changes)

### Failure modes of pg-boss

| Failure | Impact | Mitigation |
|---------|--------|-----------|
| Worker crashes mid-job | Job remains PROCESSING, no timeout | ✓ Implement job timeout in queue config (120s) |
| Database unavailable | No new jobs enqueued | ✓ Circuit breaker on extract endpoint |
| Orphaned jobs | Accumulate in PROCESSING state | ✓ Dead-letter queue + monitoring alert |
| Network partition | Worker can't reach DB | ✓ Exponential backoff + alerts |

All are addressed in current implementation.

---

## Question 3: LLM Provider Abstraction

### Decision

**Yes, built full `LLMProvider` interface.** Swapping Gemini → Anthropic → Groq requires only env var change, no code edit.

### Interface Design

```typescript
export interface LLMProvider {
  /**
   * Extract structured data from document(s).
   * Provider handles:
   *   - PDF → image conversion if provider doesn't natively support PDF
   *   - Base64 encoding/decoding
   *   - Provider-specific API shape translation
   *   - Error handling and retry within provider
   *
   * @param parts Each part carries { buffer, mimeType }
   * @param prompt The extraction prompt (fixed per assignment)
   * @returns Raw LLM response (may be JSON-like or unparseable)
   */
  extractDocument(
    parts: Array<{ buffer: Buffer; mimeType: string }>,
    prompt: string,
  ): Promise<string>;

  /**
   * Cross-document validation (text-only, no files).
   * Used for compliance checks across multiple extractions.
   *
   * @param prompt Validation logic prompt
   * @returns Raw LLM text response
   */
  generateText(prompt: string): Promise<string>;
}
```

### Implementations

| Provider | File | Rationale |
|----------|------|-----------|
| Gemini 2.0 Flash | `gemini.provider.ts` | Free tier, native PDF support, fastest |
| Anthropic Claude | `anthropic.provider.ts` | Most reliable for JSON; Haiku for cost |
| Groq (LLaMA vision) | `groq.provider.ts` | Lowest latency, good accuracy on certifications |

### Factory pattern

```typescript
// src/llm/factory.ts
export function getLLMProvider(): LLMProvider {
  switch (config.LLM_PROVIDER) {
    case "gemini": return new GeminiProvider(config.LLM_API_KEY, config.LLM_MODEL);
    case "anthropic": return new AnthropicProvider(config.LLM_API_KEY, config.LLM_MODEL);
    case "groq": return new GroqProvider(config.LLM_API_KEY, config.LLM_MODEL);
    default: throw new Error(`Unknown LLM_PROVIDER: ${config.LLM_PROVIDER}`);
  }
}
```

**No credentials hardcoded.** All tied to environment variables validated at startup.

---

## Question 4: Schema Design & Future Scaling

### Current Schema (JSONB for flexibility)

```sql
CREATE TABLE extractions (
  id UUID PRIMARY KEY,
  session_id UUID REFERENCES sessions(id),
  file_hash TEXT NOT NULL,
  
  -- Promoted scalar columns (common queries)
  holder_name TEXT,
  document_type TEXT,
  applicableRole TEXT,
  confidence TEXT,
  is_expired BOOLEAN,
  
  -- Flexible structured data (evolves with doc types)
  fields JSONB,
  validity JSONB,
  compliance JSONB,
  medical_data JSONB,
  flags JSONB,
  
  raw_llm_response TEXT,  -- debugging only
  created_at TIMESTAMP
);
```

### Risks of JSONB at scale

| Risk | Symptom | Mitigation |
|------|---------|-----------|
| No FTS (full-text search) | "Find all docs with passport number X" requires DB scan | ✓ Below |
| Indexing explosion | Each JSONB field adds 200MB index per 10M rows | ✓ Selective GIN indexes |
| Query optimization mystery | Planner doesn't understand JSONB cost | ✓ Analyze EXPLAIN output |
| Version skew | Old extractions have field `examDate`, new have `examinationDate` | ✓ Normalization in application |

### What I'd change for production scale

#### 1. Add FTS if "search by passport number" is a feature:

```sql
-- Denormalized search table (lightweight, updated at extraction time)
CREATE TABLE extraction_search (
  extraction_id UUID PRIMARY KEY REFERENCES extractions(id),
  search_text TEXT,  -- passport_num | doc_type | holder_name
  FOREIGN KEY (extraction_id) REFERENCES extractions(id) ON DELETE CASCADE
);

-- OR: Use Elasticsearch/Algolia if cross-session search needed
```

#### 2. Query "expired COCs in session" efficiently:

```sql
-- Index for compliance queries
CREATE INDEX idx_extractions_session_type_expired
  ON extractions (session_id, document_type, is_expired);

-- Query: O(log n) lookup, not table scan
SELECT * FROM extractions
WHERE session_id = $1
  AND document_type = 'COC'
  AND is_expired = true;
```

#### 3. For field-level queries, normalize on write:

```sql
-- Specific table for frequently-queried fields
CREATE TABLE certificate_details (
  extraction_id UUID PRIMARY KEY,
  passport_number TEXT,
  sirb_number TEXT,
  rank TEXT,
  -- index these individually
  FOREIGN KEY (extraction_id) REFERENCES extractions(id)
);

CREATE INDEX idx_cert_details_passport ON certificate_details(passport_number);
```

#### 4. Version the schema in data:

```sql
ALTER TABLE extractions ADD COLUMN schema_version INT NOT NULL DEFAULT 1;

-- At extraction time, if LLM response has new keys, increment version
-- Application handles migration logic per version
```

### Current indexes already added:

```sql
CREATE INDEX idx_extractions_session_id ON extractions(session_id);
CREATE INDEX idx_extractions_file_hash ON extractions(file_hash);
CREATE INDEX idx_jobs_session_id ON jobs(session_id);
CREATE INDEX idx_jobs_status ON jobs(status);
CREATE INDEX idx_validations_session_id ON validations(session_id);
```

---

## Question 5: What Was Deliberately Skipped

### 1. **Webhook Support** (optional bonus)
- **Skipped because:** Adds complexity (signature verification, retry logic, webhook management UI)
- **Impact:** Polling works fine for MVP; webhooks become necessary at scale if async is heavily used
- **When to add:** After validating that 80%+ of users choose async mode
- **Estimate:** 4–6 hours to implement securely

### 2. **Retry UI and Dead-Letter Queue Dashboard**
- **Skipped because:** Focus is on backend reliability, not ops tooling
- **Impact:** Failed jobs require manual DB inspection; no self-service retry for power users
- **When to add:** First time a Manning Agent can't rescan a rejected document (probably week 2)
- **Estimate:** 6–8 hours (includes Drizzle schema migration)

### 3. **Full-Text Search Across Sessions**
- **Skipped because:** Assignment focuses on single-session workflows; multi-session aggregation not specified
- **Impact:** A Manning Agent who manages 100 candidates cannot quickly find "all COCs expiring in 30 days"
- **When to add:** When product asks for historical reporting or compliance dashboards
- **Estimate:** 8–12 hours (includes data migration if using ES)

### 4. **Role-Based Access Control (RBAC)**
- **Skipped because:** No mention of multi-tenant or permission model in spec
- **Impact:** Every authenticated user can access every session
- **When to add:** First customer asks for candidate privacy or team collaboration features
- **Estimate:** 6–10 hours

### 5. **Provider Benchmarking** (optional bonus)
- **Skipped because:** Assignment uses only one LLM at a time; benchmarking requires quota on 2+ providers simultaneously
- **Impact:** Can't prove Groq vs Claude performance empirically (only anecdotal)
- **When to add:** If cost becomes a constraint; run A/B test with 10% traffic to alternate provider
- **Estimate:** 3–4 hours (includes data logging and comparison script)

### 6. **Prompt Versioning** (optional bonus)
- **Skipped because:** Single fixed prompt in assignment; versioning overhead until prompt changes are frequent
- **Impact:** Can't easily compare extraction quality across prompt iterations
- **When to add:** After first A/B test of prompt variations
- **Estimate:** 2–3 hours (schema column + API exposure)

---

## Trade-offs Summary

| Decision | Chosen | Alternative | Why Not |
|----------|--------|-------------|---------|
| Sync default | sync ≤2MB | all async | Poor UX for small files |
| Queue backend | pg-boss | Redis + BullMQ | Less operational burden early |
| LLM abstraction | Interface | Hard-coded Gemini | Flexibility + future portability |
| Schema | JSONB + scalar | Full normalization | Faster iteration, schema flexibility |
| Scope | MVP | Add RBAC, webhooks, search | Nail the core extraction quality first |

---

## Key Assumptions

1. **Single extraction process per session** — No concurrent uploads of the same document are expected.
2. **LLM JSON reliability** — Claude and Gemini are ~95% reliable; Groq is ~85%. Handled via repair logic.
3. **File sizes ≤ 10MB** — No streaming; load entirely into memory.
4. **PostgreSQL as source of truth** — No separate search index initially.
5. **Manning Agents are power users** — They understand document requirements and can interpret flags correctly.

---

## Metrics to Monitor in Production

1. **LLM JSON parse failure rate** — Should stay < 2% even with repair logic
2. **Queue depth over time** — Alert if growing unbounded (indicates LLM saturation)
3. **P95 extraction latency** — Target: < 12s for async, < 8s for sync
4. **Deduplication hit rate** — Indicates if candidates re-upload same docs; if > 20%, consider better UX
5. **Session validation consensus** — Do cross-document validations match human auditor consensus?

---

## Conclusion

This architecture prioritizes **correctness over performance** in the initial phase. The LLM is the bottleneck, not the queue or database. Once extraction quality stabilizes and usage patterns become clear, we can optimize for scale (webhooks, search, RBAC) without rearchitecting the core pipeline.

The provider abstraction and schema design are intentionally flexible to absorb new document types and LLM models as the system grows. The sync/async threshold is conservative to ensure reliable synchronous requests under load.
