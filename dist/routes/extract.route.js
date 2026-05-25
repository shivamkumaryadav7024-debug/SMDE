import { writeFile } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import { config } from "../config.js";
import { AppError } from "../middleware/errorHandler.js";
import { runExtraction } from "../services/extraction.service.js";
import { createSession, assertSessionExists, } from "../services/session.service.js";
import { enqueueExtractionJob } from "../queue/boss.js";
import { computeSHA256 } from "../utils/hash.js";
import { db } from "../db/client.js";
import { extractions } from "../db/schema.js";
import { and, eq } from "drizzle-orm";
const ACCEPTED_MIME_TYPES = new Set([
    "image/jpeg",
    "image/png",
    "application/pdf",
]);
export async function extractRoute(app) {
    app.post("/extract", {
        config: {
            rateLimit: {
                max: config.RATE_LIMIT_EXTRACT_RPM,
                timeWindow: "1 minute",
            },
        },
    }, async (request, reply) => {
        // Extract mode from query params — Fastify automatically parses ?mode=async
        const mode = request.query.mode ?? "sync";
        // Debug logging to help diagnose mode routing
        console.log(`[extract] mode="${mode}" query=${JSON.stringify(request.query)}`);
        // ── Parse multipart ──────────────────────────────────────────────────
        const data = await request.file();
        if (!data) {
            throw new AppError("UNSUPPORTED_FORMAT", 'No file was uploaded. Send a multipart/form-data request with a "document" field.');
        }
        const mimeType = data.mimetype;
        if (!ACCEPTED_MIME_TYPES.has(mimeType)) {
            throw new AppError("UNSUPPORTED_FORMAT", `File type "${mimeType}" is not accepted. Accepted types: image/jpeg, image/png, application/pdf.`);
        }
        // Read file buffer (size limit enforced by @fastify/multipart plugin)
        const fileBuffer = await data.toBuffer();
        const fileName = data.filename || "upload";
        // ── Session resolution ───────────────────────────────────────────────
        const fields = data.fields;
        let sessionId = fields["sessionId"]?.value?.trim() ?? "";
        if (sessionId) {
            await assertSessionExists(sessionId);
        }
        else {
            sessionId = await createSession();
        }
        // ── Deduplication check ──────────────────────────────────────────────
        const fileHash = computeSHA256(fileBuffer);
        const existing = await db.query.extractions.findFirst({
            where: and(eq(extractions.sessionId, sessionId), eq(extractions.fileHash, fileHash)),
        });
        if (existing) {
            console.log(`[extract] File already processed (dedup). mode="${mode}" Will return 200 with X-Deduplicated header.`);
            return reply
                .status(200)
                .header("X-Deduplicated", "true")
                .send(formatExtractionResponse(existing, sessionId));
        }
        // ── Async mode ───────────────────────────────────────────────────────
        if (mode === "async") {
            console.log(`[extract] Entering async mode for session ${sessionId}`);
            const filePath = path.join(config.TEMP_UPLOAD_DIR, `${randomUUID()}-${fileName}`);
            await writeFile(filePath, fileBuffer);
            const jobId = await enqueueExtractionJob({
                sessionId,
                fileName,
                filePath,
                mimeType,
                fileHash,
            });
            console.log(`[extract] Async job enqueued: ${jobId}`);
            return reply.status(202).send({
                jobId,
                sessionId,
                status: "QUEUED",
                pollUrl: `/api/jobs/${jobId}`,
                estimatedWaitMs: 6000,
            });
        }
        // ── Sync mode (default) ──────────────────────────────────────────────
        console.log(`[extract] Entering sync mode for session ${sessionId}`);
        const result = await runExtraction({
            fileBuffer,
            mimeType,
            fileName,
            sessionId,
        });
        return reply
            .status(200)
            .send(formatExtractionResponse(result, sessionId));
    });
}
function formatExtractionResponse(row, sessionId) {
    const validity = row["validity"];
    return {
        id: row["id"],
        sessionId,
        fileName: row["fileName"],
        documentType: row["documentType"],
        documentName: row["documentName"],
        applicableRole: row["applicableRole"],
        category: row["category"],
        confidence: row["confidence"],
        holderName: row["holderName"],
        dateOfBirth: row["dateOfBirth"],
        sirbNumber: row["sirbNumber"],
        passportNumber: row["passportNumber"],
        fields: row["fields"],
        validity,
        compliance: row["compliance"],
        medicalData: row["medicalData"],
        flags: row["flags"],
        isExpired: row["isExpired"],
        processingTimeMs: row["processingTimeMs"],
        summary: row["summary"],
        createdAt: row["createdAt"],
    };
}
//# sourceMappingURL=extract.route.js.map