import { readFile, unlink } from "fs/promises";
import { eq } from "drizzle-orm";
import { getBoss, QUEUE_NAME } from "./boss.js";
import { db } from "../db/client.js";
import { jobs } from "../db/schema.js";
import { runExtraction } from "../services/extraction.service.js";
import { config } from "../config.js";
export async function startWorker() {
    const boss = getBoss();
    console.log(`[worker] ⭐ STARTING WORKER`);
    console.log(`[worker] ⭐ Queue name: ${QUEUE_NAME}`);
    console.log(`[worker] ⭐ Concurrency: ${config.JOB_CONCURRENCY}`);
    boss.on("error", (err) => {
        console.error(`[worker] 🔴 pg-boss error:`, err);
    });
    try {
        console.log(`[worker] 📡 Registering work handler...`);
        // ✅ v10 WorkOptions = JobFetchOptions & JobPollingOptions only.
        //    There is NO localConcurrency / teamSize / teamConcurrency.
        //    Concurrency is controlled by batchSize (jobs fetched per poll)
        //    combined with pollingIntervalSeconds.
        //    WorkHandler<T> receives Job<T>[] (always an array).
        await boss.work(QUEUE_NAME, {
            batchSize: config.JOB_CONCURRENCY, // fetch up to N jobs per poll cycle
            pollingIntervalSeconds: 2,
        }, async (jobBatch) => {
            console.log(`[worker] 🔄 WORK HANDLER INVOKED — batch size: ${jobBatch?.length ?? 0}`);
            if (!jobBatch || jobBatch.length === 0) {
                console.log("[worker] ⚠️  Empty batch, skipping");
                return;
            }
            // Process all jobs in the batch concurrently
            await Promise.all(jobBatch.map((job) => processJob(job)));
        });
        console.log(`[worker] ⭐ WORK HANDLER REGISTERED SUCCESSFULLY`);
        console.log(`[worker] ⭐ Listening for jobs on queue: ${QUEUE_NAME}`);
    }
    catch (err) {
        console.error(`[worker] ❌ FAILED TO REGISTER WORK HANDLER:`, err);
        throw err;
    }
}
// ── Per-job processor ───────────────────────────────────────────────────────
async function processJob(job) {
    if (!job?.data) {
        console.error("[worker] ❌ Job or job.data is null, skipping");
        return;
    }
    const { jobId, sessionId, fileName, filePath, mimeType, fileHash } = job.data;
    console.log(`[worker] 📋 Processing job: ${jobId}`);
    console.log(`[worker] 📄 File: ${fileName} (${filePath})`);
    // ── Mark PROCESSING ────────────────────────────────────────────────────────
    try {
        await db
            .update(jobs)
            .set({ status: "PROCESSING", startedAt: new Date() })
            .where(eq(jobs.id, jobId));
        console.log(`[worker] ✅ Marked job ${jobId} as PROCESSING`);
    }
    catch (err) {
        console.error(`[worker] ❌ Failed to mark job PROCESSING:`, err);
        throw err;
    }
    let fileBuffer = null;
    try {
        fileBuffer = await readFile(filePath);
        console.log(`[worker] 📄 Read file: ${filePath} (${fileBuffer.length} bytes)`);
        const result = await runExtraction({
            fileBuffer,
            mimeType,
            fileName,
            sessionId,
            jobId,
        });
        console.log(`[worker] ✅ Extraction complete for job ${jobId}`);
        // ── Mark COMPLETE ──────────────────────────────────────────────────────
        await db
            .update(jobs)
            .set({
            status: "COMPLETE",
            extractionId: result.id,
            completedAt: new Date(),
            queuePosition: null,
        })
            .where(eq(jobs.id, jobId));
        console.log(`[worker] ✅ Job ${jobId} marked as COMPLETE`);
    }
    catch (err) {
        console.error(`[worker] ❌ Error processing job ${jobId}:`, err);
        const isAppError = err instanceof Error && "code" in err;
        const errorCode = isAppError
            ? err.code
            : "INTERNAL_ERROR";
        const errorMessage = err instanceof Error ? err.message : "Unknown error";
        const retryable = errorCode === "LLM_JSON_PARSE_FAIL";
        // ── Mark FAILED ────────────────────────────────────────────────────────
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
        throw err; // re-throw so pg-boss marks its internal record failed too
    }
    finally {
        // ── Always clean up the temp file ──────────────────────────────────────
        if (fileBuffer !== null) {
            await unlink(filePath).catch((e) => {
                console.warn(`[worker] ⚠️  Could not delete temp file ${filePath}:`, e);
            });
        }
    }
}
//# sourceMappingURL=worker.js.map