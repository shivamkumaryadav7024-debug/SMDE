import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { jobs, extractions } from "../db/schema.js";
import { AppError } from "../middleware/errorHandler.js";
import { config } from "../config.js";
export async function jobsRoute(app) {
    app.get("/jobs/:jobId", {
        config: {
            rateLimit: {
                max: config.RATE_LIMIT_GENERAL_RPM,
                timeWindow: "1 minute",
            },
        },
    }, async (request, reply) => {
        const { jobId } = request.params;
        const job = await db.query.jobs.findFirst({
            where: eq(jobs.id, jobId),
        });
        if (!job) {
            throw new AppError("JOB_NOT_FOUND", `Job '${jobId}' not found.`);
        }
        if (job.status === "QUEUED" || job.status === "PROCESSING") {
            return reply.status(200).send({
                jobId: job.id,
                status: job.status,
                queuePosition: job.queuePosition,
                startedAt: job.startedAt,
                estimatedCompleteMs: 6000,
            });
        }
        if (job.status === "COMPLETE" && job.extractionId) {
            const extraction = await db.query.extractions.findFirst({
                where: eq(extractions.id, job.extractionId),
            });
            return reply.status(200).send({
                jobId: job.id,
                status: "COMPLETE",
                extractionId: job.extractionId,
                result: extraction ?? null,
                completedAt: job.completedAt,
            });
        }
        // FAILED
        return reply.status(200).send({
            jobId: job.id,
            status: "FAILED",
            error: job.errorCode,
            message: job.errorMessage,
            failedAt: job.failedAt,
            retryable: job.retryable,
        });
    });
}
//# sourceMappingURL=jobs.route.js.map