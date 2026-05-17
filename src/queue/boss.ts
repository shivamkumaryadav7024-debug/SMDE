import PgBoss from "pg-boss";
import { config } from "../config.js";
import { db } from "../db/client.js";
import { jobs } from "../db/schema.js";
import { eq } from "drizzle-orm";

export const QUEUE_NAME = "document-extraction";

export interface ExtractionJobPayload {
  jobId: string;
  sessionId: string;
  fileName: string;
  filePath: string;
  mimeType: string;
  fileHash: string;
}

let _boss: PgBoss | null = null;

export async function initBoss(): Promise<PgBoss> {
  if (_boss) return _boss;

  _boss = new PgBoss({
    connectionString: config.DATABASE_URL,
    // Keep completed jobs for 24 h, failed jobs for 7 days
    deleteAfterHours: 24,
    archiveFailedAfterSeconds: 604800, // 7 days
  });

  _boss.on("error", (err) => {
    console.error("[queue] pg-boss error:", err);
  });

  await _boss.start();
  console.log("[queue] pg-boss started");
  return _boss;
}

export function getBoss(): PgBoss {
  if (!_boss)
    throw new Error("pg-boss has not been initialised. Call initBoss() first.");
  return _boss;
}

export async function pingQueue(): Promise<boolean> {
  try {
    getBoss(); // throws if not initialised
    return true;
  } catch {
    return false;
  }
}

/**
 * Insert a row in our `jobs` table (for client-visible status polling)
 * and enqueue the work in pg-boss.
 *
 * Returns the jobId so the route can return it immediately.
 */
export async function enqueueExtractionJob(
  payload: Omit<ExtractionJobPayload, "jobId"> & { sessionId: string },
): Promise<string> {
  // 1. Count pending jobs to derive an approximate queue position
  const pendingCount = await db.$count(jobs, eq(jobs.status, "QUEUED"));
  const queuePosition = pendingCount + 1;

  // 2. Insert client-visible job row first
  const [row] = await db
    .insert(jobs)
    .values({
      sessionId: payload.sessionId,
      status: "QUEUED",
      queuePosition,
      fileName: payload.fileName,
      filePath: payload.filePath,
      mimeType: payload.mimeType,
      fileHash: payload.fileHash,
    })
    .returning({ id: jobs.id });

  if (!row) throw new Error("Failed to insert job row");

  const jobId = row.id;

  // 3. Send to pg-boss with the same jobId so the worker can correlate
  await getBoss().send(
    QUEUE_NAME,
    { ...payload, jobId } satisfies ExtractionJobPayload,
    {
      retryLimit: 1,
      retryDelay: 5,
      expireInHours: 1,
    },
  );

  return jobId;
}
