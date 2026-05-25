import { eq, and } from "drizzle-orm";
import { db } from "../db/client.js";
import { extractions } from "../db/schema.js";
import { getLLMProvider } from "../llm/factory.js";
import { EXTRACTION_PROMPT } from "../llm/prompt.js";
import { computeSHA256 } from "../utils/hash.js";
import { daysUntilExpiry, isExpired } from "../utils/dateUtils.js";
import { AppError } from "../middleware/errorHandler.js";
import { randomUUID } from "crypto";
export async function runExtraction(params) {
    const { fileBuffer, mimeType, fileName, sessionId, jobId } = params;
    const startedAt = Date.now();
    // ── 1. Hash ──────────────────────────────────────────────────────────────
    const fileHash = computeSHA256(fileBuffer);
    // ── 2. Deduplication check ───────────────────────────────────────────────
    const existing = await db.query.extractions.findFirst({
        where: and(eq(extractions.sessionId, sessionId), eq(extractions.fileHash, fileHash)),
    });
    if (existing) {
        return { ...rowToResult(existing), isDuplicate: true };
    }
    // ── 3. Build file parts for the LLM ─────────────────────────────────────
    // Send to LLM for extraction
    const llmParts = [{ buffer: fileBuffer, mimeType }];
    // ── 4. Call LLM with one retry on JSON parse failure ────────────────────
    const llm = getLLMProvider();
    let parsed = null;
    let rawResponse = "";
    let extractionId;
    for (let attempt = 1; attempt <= 2; attempt++) {
        rawResponse = await llm.extractDocument(llmParts, EXTRACTION_PROMPT);
        try {
            parsed = JSON.parse(rawResponse);
            break;
        }
        catch {
            if (attempt === 2) {
                // Store the failed record so the raw response is available for review
                extractionId = randomUUID();
                await db.insert(extractions).values({
                    id: extractionId,
                    sessionId,
                    jobId: jobId ?? null,
                    fileName,
                    fileHash,
                    mimeType,
                    rawLlmResponse: rawResponse,
                    processingTimeMs: Date.now() - startedAt,
                });
                throw new AppError("LLM_JSON_PARSE_FAIL", "Document extraction failed after retry. The raw response has been stored for review.", extractionId);
            }
        }
    }
    if (!parsed) {
        throw new AppError("LLM_JSON_PARSE_FAIL", "Unexpected extraction failure.");
    }
    // ── 5. Compute derived validity fields ───────────────────────────────────
    const expiryRaw = parsed.validity?.dateOfExpiry ?? null;
    const computedIsExpired = isExpired(expiryRaw);
    const computedDaysUntilExpiry = daysUntilExpiry(expiryRaw);
    const validityWithComputed = {
        ...(parsed.validity ?? {}),
        isExpired: computedIsExpired,
        daysUntilExpiry: computedDaysUntilExpiry,
    };
    // ── 6. Persist ────────────────────────────────────────────────────────────
    const row = {
        sessionId,
        jobId: jobId ?? null,
        fileName,
        fileHash,
        mimeType,
        documentType: parsed.detection?.documentType ?? null,
        documentName: parsed.detection?.documentName ?? null,
        applicableRole: parsed.detection?.applicableRole ?? null,
        category: parsed.detection?.category ?? null,
        confidence: parsed.detection?.confidence ?? null,
        holderName: parsed.holder?.fullName ?? null,
        dateOfBirth: parsed.holder?.dateOfBirth ?? null,
        sirbNumber: parsed.holder?.sirbNumber ?? null,
        passportNumber: parsed.holder?.passportNumber ?? null,
        fields: parsed.fields ?? null,
        validity: validityWithComputed,
        compliance: parsed.compliance ?? null,
        medicalData: parsed.medicalData ?? null,
        flags: parsed.flags ?? null,
        isExpired: computedIsExpired,
        summary: parsed.summary ?? null,
        processingTimeMs: Date.now() - startedAt,
    };
    const [inserted] = await db.insert(extractions).values(row).returning();
    if (!inserted) {
        throw new AppError("INTERNAL_ERROR", "Failed to persist extraction record.");
    }
    return rowToResult(inserted);
}
// ── Helper: map DB row to ExtractionResult ──────────────────────────────────
function rowToResult(row) {
    return {
        id: row.id,
        sessionId: row.sessionId,
        jobId: row.jobId,
        fileName: row.fileName,
        documentType: row.documentType,
        documentName: row.documentName,
        applicableRole: row.applicableRole,
        category: row.category,
        confidence: row.confidence,
        holderName: row.holderName,
        dateOfBirth: row.dateOfBirth,
        sirbNumber: row.sirbNumber,
        passportNumber: row.passportNumber,
        fields: row.fields,
        validity: row.validity,
        compliance: row.compliance,
        medicalData: row.medicalData,
        flags: row.flags,
        isExpired: row.isExpired,
        summary: row.summary,
        processingTimeMs: row.processingTimeMs,
        createdAt: row.createdAt,
    };
}
//# sourceMappingURL=extraction.service.js.map