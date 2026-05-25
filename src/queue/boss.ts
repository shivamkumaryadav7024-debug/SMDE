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

  console.log("[queue] Initializing pg-boss...");

  // ✅ Only use options that exist in v10 ConstructorOptions:
  //    - deleteAfterHours is in MaintenanceOptions
  //    - archiveFailedAfterSeconds is in MaintenanceOptions
  //    - maintenanceIntervalSeconds is in MaintenanceOptions (NOT monitorIntervalSeconds)
  //    - pollingIntervalSeconds is in JobPollingOptions (also part of ConstructorOptions)
  _boss = new PgBoss({
    connectionString: config.DATABASE_URL,
    deleteAfterHours: 24,
    archiveFailedAfterSeconds: 60 * 60 * 24 * 7, // 7 days
    maintenanceIntervalSeconds: 10,
    pollingIntervalSeconds: 2,
  } satisfies PgBoss.ConstructorOptions);

  _boss.on("error", (err) => {
    console.error("[queue] pg-boss error:", err);
  });

  try {
    await _boss.start();
    console.log("[queue] pg-boss started successfully");

    // ✅ v10 createQueue second arg is PgBoss.Queue which REQUIRES name.
    //    Pass it as the name arg + rest as the Queue object with name included.
    //    The overload is: createQueue(name: string, options?: PgBoss.Queue)
    //    PgBoss.Queue = RetryOptions & ExpirationOptions & RetentionOptions & { name, policy?, deadLetter? }
    //    So we pass name separately, then options without name — but the type
    //    requires name in the options object too. We satisfy both:
    await _boss.createQueue(QUEUE_NAME, {
      name: QUEUE_NAME,
      retentionHours: 24,
      retryLimit: 1,
      retryDelay: 5,
      expireInHours: 1,
    });
    console.log(`[queue] Queue "${QUEUE_NAME}" ensured`);
  } catch (err: unknown) {
    // pg-boss throws if the queue already exists on some versions — ignore that
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.toLowerCase().includes("already exists")) {
      console.log(`[queue] Queue "${QUEUE_NAME}" already exists, continuing`);
    } else {
      console.error("[queue] Failed to start pg-boss:", err);
      _boss = null;
      throw err;
    }
  }

  return _boss;
}

export function getBoss(): PgBoss {
  if (!_boss) {
    throw new Error(
      "pg-boss has not been initialised. Call initBoss() first."
    );
  }
  return _boss;
}

export async function pingQueue(): Promise<boolean> {
  try {
    getBoss();
    return true;
  } catch {
    return false;
  }
}

export async function enqueueExtractionJob(
  payload: Omit<ExtractionJobPayload, "jobId"> & { sessionId: string }
): Promise<string> {
  const pendingCount = await db.$count(jobs, eq(jobs.status, "QUEUED"));
  const queuePosition = pendingCount + 1;

  console.log(
    `[queue] Enqueuing job for file: ${payload.fileName}, queue position: ${queuePosition}`
  );

  // Insert client-visible job row first so polling works immediately
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
  console.log(`[queue] DB job row created: ${jobId}`);

  // ✅ send() options type is SendOptions = JobOptions & ExpirationOptions
  //    & RetentionOptions & RetryOptions & ConnectionOptions
  const pgBossId = await getBoss().send(
    QUEUE_NAME,
    { ...payload, jobId } as ExtractionJobPayload,
    {
      expireInHours: 1,
      retryLimit: 1,
      retryDelay: 5,
    } satisfies PgBoss.SendOptions
  );

  if (!pgBossId) {
    throw new Error(
      `pg-boss rejected job for ${jobId} — queue may not exist or send was throttled`
    );
  }

  console.log(
    `[queue] ✅ Job sent to pg-boss: jobId=${jobId} pgBossId=${pgBossId}`
  );
  return jobId;
}