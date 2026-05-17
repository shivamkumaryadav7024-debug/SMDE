import { readFile, unlink } from "fs/promises";
import { eq } from "drizzle-orm";
import { getBoss, QUEUE_NAME, type ExtractionJobPayload } from "./boss.js";
import { db } from "../db/client.js";
import { jobs } from "../db/schema.js";
import { runExtraction } from "../services/extraction.service.js";
import { config } from "../config.js";

export function startWorker(): void {
  const boss = getBoss();

  boss.work<ExtractionJobPayload>(
    QUEUE_NAME,
    { batchSize: 1 },
    async (pgBossJobs) => {
      const job = pgBossJobs[0];
      if (!job) return;
      const { jobId, sessionId, fileName, filePath, mimeType, fileHash } =
        job.data;

      // ── Mark PROCESSING ────────────────────────────────────────────────────
      await db
        .update(jobs)
        .set({ status: "PROCESSING", startedAt: new Date() })
        .where(eq(jobs.id, jobId));

      let fileBuffer: Buffer | null = null;

      try {
        fileBuffer = await readFile(filePath);

        const result = await runExtraction({
          fileBuffer,
          mimeType,
          fileName,
          sessionId,
          jobId,
        });

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
      } catch (err) {
        const isAppError = err instanceof Error && "code" in err;
        const errorCode = isAppError
          ? (err as { code: string }).code
          : "INTERNAL_ERROR";
        const errorMessage =
          err instanceof Error ? err.message : "Unknown error";
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

        // Re-throw so pg-boss records the failure and applies retry logic
        throw err;
      } finally {
        // ── Always clean up the temp file ────────────────────────────────────
        if (fileBuffer !== null) {
          await unlink(filePath).catch((e) => {
            console.warn(`[worker] Could not delete temp file ${filePath}:`, e);
          });
        }
      }
    },
  );

  console.log(
    `[worker] Listening on queue "${QUEUE_NAME}" (concurrency: ${config.JOB_CONCURRENCY})`,
  );
}
