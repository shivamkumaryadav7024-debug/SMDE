# Maritime Manning Agent — Document Extraction Service

A production-oriented backend that processes maritime seafarer certification documents (certificates, medical exams, passports, drug tests) and extracts structured data automatically using a vision-capable LLM.

**Tech Stack:** Node.js + TypeScript, Fastify, PostgreSQL, Drizzle ORM, pg-boss, Configurable LLM providers (Gemini, Claude, Groq)

---

## Quick Start (5 minutes)

### Prerequisites

- **Node.js** 20+ ([download](https://nodejs.org))
- **Docker & Docker Compose** ([install](https://docs.docker.com/get-docker/))
- **LLM API key** — choose one:
  - [Google Gemini](https://aistudio.google.com) (free, no credit card)
  - [Groq](https://console.groq.com) (free tier)
  - [Anthropic Claude](https://console.anthropic.com) (free credits)

### Setup

```bash
# 1. Clone and enter repo
cd /path/to/maritime-extraction

# 2. Copy environment template and fill in your LLM credentials
cp .env.example .env

# Edit .env with your LLM provider details:
# LLM_PROVIDER=gemini          # or groq, anthropic
# LLM_MODEL=gemini-2.0-flash   # or specific model for your provider
# LLM_API_KEY=your_key_here    # Your API key (no quotes)

# 3. Start PostgreSQL (Docker)
docker-compose up -d

# 4. Install dependencies
npm install

# 5. Run database migrations
npm run db:migrate

# 6. Start the development server
npm run dev
```

**Server runs at:** `http://localhost:3000`

---

## Available Scripts

| Command | Purpose |
|---------|---------|
| `npm run dev` | Start dev server with hot-reload (Ctrl+C to stop) |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run compiled production build |
| `npm run db:migrate` | Apply pending database migrations |
| `npm run db:generate` | Generate a new migration (after schema changes) |
| `npm run db:studio` | Open Drizzle Studio — graphical DB browser |
| `npm test` | Run test suite (vitest) |

---

## API Endpoints

### Extract a Document

**`POST /api/extract`**

Upload a maritime document and extract structured data. Supports **sync** (immediate response) or **async** (job-based polling) modes.

**Request:**
```bash
# Sync mode (default, blocks until done)
curl -X POST http://localhost:3000/api/extract \
  -F "document=@passport.pdf" \
  -F "sessionId=your-session-id"

# Async mode (returns immediately, returns jobId)
curl -X POST "http://localhost:3000/api/extract?mode=async" \
  -F "document=@certificate.jpg" \
  -F "sessionId=your-session-id"
```

**Accepted file types:** `image/jpeg`, `image/png`, `application/pdf` (max 10MB)

**Sync response (200 OK):**
```json
{
  "id": "uuid",
  "sessionId": "uuid",
  "fileName": "PEME_Sample.pdf",
  "documentType": "PEME",
  "documentName": "Pre-Employment Medical Examination",
  "applicableRole": "ENGINE",
  "category": "MEDICAL",
  "confidence": "HIGH",
  "holderName": "John Smith",
  "dateOfBirth": "05/12/1988",
  "sirbNumber": "C1234567",
  "passportNumber": null,
  "fields": [...],
  "validity": {
    "dateOfIssue": "06/01/2025",
    "dateOfExpiry": "06/01/2027",
    "isExpired": false,
    "daysUntilExpiry": 660
  },
  "compliance": {...},
  "medicalData": {...},
  "flags": [],
  "isExpired": false,
  "processingTimeMs": 4230,
  "summary": "...",
  "createdAt": "2026-03-17T08:42:11Z"
}
```

**Async response (202 Accepted):**
```json
{
  "jobId": "uuid",
  "sessionId": "uuid",
  "status": "QUEUED",
  "pollUrl": "/api/jobs/uuid",
  "estimatedWaitMs": 6000
}
```

---

### Poll Job Status

**`GET /api/jobs/:jobId`**

Check the status of an async extraction job.

```bash
curl http://localhost:3000/api/jobs/{jobId}
```

**Response (processing):**
```json
{
  "jobId": "uuid",
  "status": "PROCESSING",
  "queuePosition": 2,
  "startedAt": "2026-03-17T08:42:00Z",
  "estimatedCompleteMs": 3200
}
```

**Response (complete):**
```json
{
  "jobId": "uuid",
  "status": "COMPLETE",
  "extractionId": "uuid",
  "result": { ... },
  "completedAt": "2026-03-17T08:42:11Z"
}
```

---

### Get Session Summary

**`GET /api/sessions/:sessionId`**

Returns all documents extracted in a session.

```bash
curl http://localhost:3000/api/sessions/{sessionId}
```

**Response:**
```json
{
  "sessionId": "uuid",
  "documentCount": 5,
  "detectedRole": "DECK",
  "overallHealth": "WARN",
  "documents": [
    {
      "id": "uuid",
      "fileName": "COC.jpg",
      "documentType": "COC",
      "applicableRole": "DECK",
      "holderName": "Francisco J. Salonoy",
      "confidence": "HIGH",
      "isExpired": false,
      "flagCount": 0,
      "createdAt": "2026-03-17T08:40:00Z"
    }
  ],
  "pendingJobs": []
}
```

---

### Cross-Document Validation

**`POST /api/sessions/:sessionId/validate`**

Validates all documents in a session for compliance using the LLM. Checks:
- Consistency across documents (same name, DOB, rank?)
- Missing required certifications
- Expiring documents
- Medical or compliance flags

```bash
curl -X POST http://localhost:3000/api/sessions/{sessionId}/validate
```

**Response:**
```json
{
  "sessionId": "uuid",
  "holderProfile": {
    "name": "John Smith",
    "rank": "Master",
    "certifications": 5
  },
  "consistencyChecks": [
    {
      "check": "Name consistency",
      "status": "PASS",
      "details": "All documents show 'John Smith'"
    }
  ],
  "missingDocuments": [
    {
      "documentType": "YELLOW_FEVER",
      "isRequired": true,
      "recommendation": "Upload yellow fever vaccination certificate"
    }
  ],
  "expiringDocuments": [
    {
      "documentType": "COC",
      "expiresIn": 45,
      "expiryDate": "2026-05-01"
    }
  ],
  "medicalFlags": [],
  "overallStatus": "APPROVED",
  "overallScore": 92,
  "summary": "Candidate profile is complete and compliant.",
  "recommendations": [
    "Renew COC before May 2026",
    "Consider retraining on ECDIS if not current"
  ],
  "validatedAt": "2026-03-17T08:45:00Z"
}
```

---

### Get Compliance Report

**`GET /api/sessions/:sessionId/report`**

Returns a human-readable compliance report for the session, suitable for hiring decisions.

```bash
curl http://localhost:3000/api/sessions/{sessionId}/report
```

**Response:**
```json
{
  "sessionId": "uuid",
  "candidateName": "John Smith",
  "detectedRole": "DECK",
  "overallComplianceStatus": "APPROVED",
  "complianceScore": 92,
  "documentsSummary": {
    "total": 7,
    "expired": 0,
    "expiringWithin90Days": 1,
    "medicalFlagCount": 0
  },
  "criticalItems": [
    "COC expires 2026-05-01 (45 days)"
  ],
  "warningItems": [],
  "cleanItems": [
    "All medical certifications valid",
    "No drug test anomalies"
  ],
  "missingRequiredDocuments": [],
  "generatedAt": "2026-03-17T08:45:00Z",
  "reportId": "uuid"
}
```

---

### Health Check

**`GET /api/health`**

System status and dependency health.

```bash
curl http://localhost:3000/api/health
```

**Response:**
```json
{
  "status": "OK",
  "version": "1.0.0",
  "uptime": 3612,
  "dependencies": {
    "database": "OK",
    "llmProvider": "OK",
    "queue": "OK"
  },
  "timestamp": "2026-03-17T08:45:00Z"
}
```

---

## Testing

### With Postman

Import the included Postman collection:
```bash
# Import in Postman:
# 1. Click "Import"
# 2. Select postman/Maritime_Manning_Agent.postman_collection.json
# 3. Import environment: postman/Maritime_Manning_Agent.postman_environment.json
# 4. Set your sessionId or create a new one
# 5. Run requests in order: extract → jobs → sessions → validate → report
```

### With cURL

```bash
# Extract document (sync)
SESSION_ID=$(uuidgen)
curl -X POST http://localhost:3000/api/extract \
  -F "document=@/path/to/document.pdf" \
  -F "sessionId=$SESSION_ID" | jq .

# Get session
curl http://localhost:3000/api/sessions/$SESSION_ID | jq .

# Validate session
curl -X POST http://localhost:3000/api/sessions/$SESSION_ID/validate | jq .

# Get report
curl http://localhost:3000/api/sessions/$SESSION_ID/report | jq .
```

### With Docker (without local setup)

If you prefer not to install Node locally:

```bash
# Start both DB and app in containers
docker-compose -f docker-compose.yml -f docker-compose.app.yml up

# Then run curl commands above
```

---

## Environment Variables

Copy `.env.example` and fill in:

```bash
# Server
PORT=3000
NODE_ENV=development

# Database
DATABASE_URL=postgresql://user:password@localhost:5432/maritime

# LLM Provider — choose one
LLM_PROVIDER=gemini                    # gemini | groq | anthropic
LLM_MODEL=gemini-2.0-flash             # Model name for your provider
LLM_API_KEY=your_api_key_here          # Your API key

# File handling
MAX_FILE_SIZE_MB=10
TEMP_UPLOAD_DIR=/tmp/maritime-uploads

# Queue
JOB_CONCURRENCY=3                      # How many jobs to process in parallel

# Rate limiting
RATE_LIMIT_EXTRACT_RPM=20              # Max 20 extractions per minute per IP
RATE_LIMIT_GENERAL_RPM=60              # Max 60 requests per minute per IP
```

---

## Architecture

### Components

- **Fastify server** — HTTP API with multipart file upload, rate limiting, error handling
- **PostgreSQL database** — Stores sessions, extractions, jobs, validation results
- **Drizzle ORM** — Type-safe, SQL-first database access
- **pg-boss queue** — Job queue backed by PostgreSQL; survives server restarts
- **LLM Provider abstraction** — Supports Gemini, Groq, Anthropic without code changes
- **JSON repair logic** — Handles malformed LLM responses, retries with focused prompts

### Data Flow

```
POST /api/extract
    ↓
[Validate file + session]
    ↓
[Compute SHA-256 hash, check deduplication]
    ↓
[If sync] → [Call LLM] → [Parse/repair JSON] → [Store + respond]
[If async] → [Enqueue job] → [Respond 202] → [Worker picks up job] → [Call LLM] → [Store result]
    ↓
GET /api/jobs/:jobId → [Poll queue] → [Return status]
    ↓
GET /api/sessions/:sessionId → [Query all extractions in session]
    ↓
POST /api/sessions/:sessionId/validate → [Gather extractions] → [Call LLM for cross-doc check]
    ↓
GET /api/sessions/:sessionId/report → [Assemble report from DB data]
```

### Database Schema

- **sessions** — UUID, timestamp
- **extractions** — Document metadata, LLM output (JSON), status, timestamps
- **jobs** — Async job tracking, queue state, timestamps
- **validations** — Cross-document compliance results, timestamps

See `src/db/schema.ts` for full schema.

---

## Troubleshooting

### "Database connection failed"

```bash
# Check Docker is running
docker-compose ps

# If not, start it
docker-compose up -d

# Check the connection string in .env
# Format: postgresql://user:password@host:port/database
```

### "LLM API key invalid"

```bash
# Verify your key in .env (no quotes, no spaces)
# Test it directly with the LLM provider:
# - Gemini: aistudio.google.com → check key works
# - Groq: console.groq.com → test API
# - Anthropic: console.anthropic.com → test API

# Restart the server after updating .env
npm run dev
```

### "File too large" (413 error)

Increase `MAX_FILE_SIZE_MB` in `.env` (default: 10MB). Note: larger files take longer to process.

### "Queue jobs stuck in PROCESSING"

```bash
# Check the queue table directly
npm run db:studio
# Browse jobs table, look for status='PROCESSING' without recent startedAt

# Restart the worker (stops and picks up orphaned jobs)
npm run dev
```

### "Extractions return LOW confidence"

This is normal for non-maritime documents. The LLM is working correctly—it's telling you the document doesn't match maritime taxonomy. Test with actual maritime documents (certificates, medical exams, passports).

---

## Production Deployment

### Key Considerations

1. **Secrets management:** Use AWS Secrets Manager, HashiCorp Vault, or environment variables (via CI/CD, not committed).
2. **Database backup:** PostgreSQL backups should be automated (daily minimum).
3. **Monitoring:** Track LLM failure rates, queue depth, extraction latency.
4. **Scaling:** Horizontally scale workers by running multiple Node processes; they all read from the same queue.
5. **LLM provider redundancy:** If one provider times out, automatically fail over to another.

### Docker Build

```bash
# Build production image
docker build -t maritime-extraction:1.0.0 .

# Run
docker run -p 3000:3000 \
  -e DATABASE_URL=postgresql://... \
  -e LLM_PROVIDER=gemini \
  -e LLM_MODEL=gemini-2.0-flash \
  -e LLM_API_KEY=... \
  maritime-extraction:1.0.0
```

---

## Contributing

1. Make changes in a feature branch: `git checkout -b feat/your-feature`
2. Write tests for new logic
3. Ensure no TypeScript errors: `npm run build`
4. Open a PR for code review

---

## License

Internal use only (© Skycladventures).

---

## Support

For questions or issues:
- Check [ADR.md](./ADR.md) for architectural decisions
- Review [CODE_REVIEW.md](./CODE_REVIEW.md) for code patterns
- Open an issue on the internal repo
- Contact the backend team

## API Endpoints

| Method | Path                                | Description                                         |
| ------ | ----------------------------------- | --------------------------------------------------- |
| `POST` | `/api/extract`                      | Upload and extract a document (`?mode=sync\|async`) |
| `GET`  | `/api/jobs/:jobId`                  | Poll async job status                               |
| `GET`  | `/api/sessions/:sessionId`          | Get all documents in a session                      |
| `POST` | `/api/sessions/:sessionId/validate` | Cross-document compliance check                     |
| `GET`  | `/api/sessions/:sessionId/report`   | Full compliance report                              |
| `GET`  | `/api/health`                       | Health check                                        |
