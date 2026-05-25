import { readFile, unlink } from "fs/promises";
import { eq } from "drizzle-orm";
import { getBoss, QUEUE_NAME, type ExtractionJobPayload } from "./boss.js";
import { db } from "../db/client.js";
import { jobs } from "../db/schema.js";
import { runExtraction } from "../services/extraction.service.js";
import { config } from "../config.js";
import type PgBoss from "pg-boss";

export async function startWorker(): Promise<void> {
  const boss = getBoss();

  console.log(`[worker] ⭐ STARTING WORKER`);
  console.log(`[worker] ⭐ Queue name: ${QUEUE_NAME}`);
  console.log(`[worker] ⭐ Concurrency: ${config.JOB_CONCURRENCY}`);

  boss.on("error", (err) => {
    console.error(`[worker] 🔴 pg-boss error:`, err);
  });

  try {
    console.log(`[worker] 📡 Registering work handler...`);

    await boss.work<ExtractionJobPayload>(
      QUEUE_NAME,
      {
        batchSize: config.JOB_CONCURRENCY,
        pollingIntervalSeconds: 2,
      } satisfies PgBoss.WorkOptions,
      async (jobBatch: PgBoss.Job<ExtractionJobPayload>[]) => {
        console.log(
          `[worker] 🔄 WORK HANDLER INVOKED — batch size: ${jobBatch?.length ?? 0}`,
        );

        if (!jobBatch || jobBatch.length === 0) {
          console.log("[worker] ⚠️  Empty batch, skipping");
          return;
        }

        await Promise.all(jobBatch.map((job) => processJob(job)));
      },
    );

    console.log(`[worker] ⭐ WORK HANDLER REGISTERED SUCCESSFULLY`);
    console.log(`[worker] ⭐ Listening for jobs on queue: ${QUEUE_NAME}`);
  } catch (err) {
    console.error(`[worker] ❌ FAILED TO REGISTER WORK HANDLER:`, err);
    throw err;
  }
}

// ── Per-job processor ────────────────────────────────────────────────────────

async function processJob(
  job: PgBoss.Job<ExtractionJobPayload>,
): Promise<void> {
  if (!job?.data) {
    console.error("[worker] ❌ Job or job.data is null, skipping");
    return;
  }

  const { jobId, sessionId, fileName, filePath, mimeType } = job.data;

  console.log(`[worker] 📋 Processing job: ${jobId}`);
  console.log(`[worker] 📄 File: ${fileName} (${filePath})`);

  // ── Mark PROCESSING ──────────────────────────────────────────────────────
  try {
    await db
      .update(jobs)
      .set({ status: "PROCESSING", startedAt: new Date() })
      .where(eq(jobs.id, jobId));
    console.log(`[worker] ✅ Marked job ${jobId} as PROCESSING`);
  } catch (err) {
    console.error(`[worker] ❌ Failed to mark job PROCESSING:`, err);
    throw err;
  }

  // Track success so we only delete the temp file after a successful run.
  // If the job fails, pg-boss may retry it and the worker needs the file
  // to still exist at filePath.
  let succeeded = false;

  try {
    const fileBuffer = await readFile(filePath);
    console.log(
      `[worker] 📄 Read file: ${filePath} (${fileBuffer.length} bytes)`,
    );

    const result = await runExtraction({
      fileBuffer,
      mimeType,
      fileName,
      sessionId,
      jobId,
    });

    console.log(`[worker] ✅ Extraction complete for job ${jobId}`);

    // ── Mark COMPLETE ────────────────────────────────────────────────────
    await db
      .update(jobs)
      .set({
        status: "COMPLETE",
        extractionId: result.id,
        completedAt: new Date(),
        queuePosition: null,
      })
      .where(eq(jobs.id, jobId));

    succeeded = true;
    console.log(`[worker] ✅ Job ${jobId} marked as COMPLETE`);
  } catch (err) {
    console.error(`[worker] ❌ Error processing job ${jobId}:`, err);

    const isAppError = err instanceof Error && "code" in err;
    const errorCode = isAppError
      ? (err as { code: string }).code
      : "INTERNAL_ERROR";
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    const retryable = errorCode === "LLM_JSON_PARSE_FAIL";

    // ── Mark FAILED ──────────────────────────────────────────────────────
    await db
      .update(jobs)
      .set({
        status: "FAILED",
        errorCode,
        errorMessage,
        retryable,
        failedAt: new Date(),
        queuePosition: null,
      })
      .where(eq(jobs.id, jobId));

    console.log(`[worker] ❌ Job ${jobId} marked as FAILED: ${errorCode}`);

    // Re-throw so pg-boss marks its internal record failed and can retry
    throw err;
  } finally {
    // ── Only delete the temp file after success ──────────────────────────
    // On failure, pg-boss retryLimit allows another attempt that still
    // needs the file at filePath. Once succeeded the file is no longer
    // needed and we clean it up to avoid filling /tmp.
    if (succeeded) {
      await unlink(filePath).catch((e) => {
        console.warn(
          `[worker] ⚠️  Could not delete temp file ${filePath}:`,
          e,
        );
      });
    } else {
      console.log(
        `[worker] ℹ️  Keeping temp file ${filePath} for potential retry`,
      );
    }
  }
}