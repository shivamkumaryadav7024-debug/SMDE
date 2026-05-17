# Maritime Manning Agent — Document Extraction Service

## Prerequisites

- Node.js 20+
- Docker & Docker Compose

## Setup

```bash
# 1. Copy env file and fill in your API key
cp .env.example .env

# 2. Start PostgreSQL
docker-compose up -d

# 3. Install dependencies
npm install

# 4. Run database migrations
npm run db:migrate

# 5. Start development server
npm run dev
```

The server starts at `http://localhost:3000`.

## Scripts

| Command               | Purpose                                    |
| --------------------- | ------------------------------------------ |
| `npm run dev`         | Start dev server with hot-reload           |
| `npm run build`       | Compile TypeScript to `dist/`              |
| `npm start`           | Run compiled output                        |
| `npm run db:migrate`  | Apply pending migrations                   |
| `npm run db:generate` | Generate new migration from schema changes |
| `npm run db:studio`   | Open Drizzle Studio (DB UI)                |
| `npm test`            | Run test suite                             |

## Environment Variables

See `.env.example` for all required variables. Key ones:

| Variable       | Description                      |
| -------------- | -------------------------------- |
| `DATABASE_URL` | PostgreSQL connection string     |
| `LLM_PROVIDER` | LLM provider: `gemini` (default) |
| `LLM_MODEL`    | Model name: `gemini-2.0-flash`   |
| `LLM_API_KEY`  | API key for the LLM provider     |

## API Endpoints

| Method | Path                                | Description                                         |
| ------ | ----------------------------------- | --------------------------------------------------- |
| `POST` | `/api/extract`                      | Upload and extract a document (`?mode=sync\|async`) |
| `GET`  | `/api/jobs/:jobId`                  | Poll async job status                               |
| `GET`  | `/api/sessions/:sessionId`          | Get all documents in a session                      |
| `POST` | `/api/sessions/:sessionId/validate` | Cross-document compliance check                     |
| `GET`  | `/api/sessions/:sessionId/report`   | Full compliance report                              |
| `GET`  | `/api/health`                       | Health check                                        |
