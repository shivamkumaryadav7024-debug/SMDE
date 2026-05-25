import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { extractions, validations } from "../db/schema.js";
import { getLLMProvider } from "../llm/factory.js";
import { buildValidationPrompt, } from "../llm/prompt.js";
import { AppError } from "../middleware/errorHandler.js";
import { assertSessionExists } from "./session.service.js";
export async function runValidation(sessionId) {
    await assertSessionExists(sessionId);
    const extractionRows = await db.query.extractions.findMany({
        where: eq(extractions.sessionId, sessionId),
    });
    if (extractionRows.length < 2) {
        throw new AppError("INSUFFICIENT_DOCUMENTS", "At least 2 documents are required to run compliance validation.");
    }
    // Build the summary list to send to the LLM
    const summaries = extractionRows.map((row) => ({
        id: row.id,
        documentType: row.documentType,
        documentName: row.documentName,
        applicableRole: row.applicableRole,
        holderName: row.holderName,
        dateOfBirth: row.dateOfBirth,
        sirbNumber: row.sirbNumber,
        passportNumber: row.passportNumber,
        validity: row.validity,
        compliance: row.compliance,
        medicalData: row.medicalData,
        flags: row.flags,
        isExpired: row.isExpired,
        summary: row.summary,
    }));
    const prompt = buildValidationPrompt(summaries);
    const llm = getLLMProvider();
    // Text-only call — no document images needed for cross-document validation
    const raw = await llm.generateText(prompt);
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch {
        throw new AppError("LLM_JSON_PARSE_FAIL", "Compliance validation failed: LLM returned an unparseable response.");
    }
    const [row] = await db
        .insert(validations)
        .values({
        sessionId,
        holderProfile: parsed.holderProfile ?? null,
        consistencyChecks: parsed.consistencyChecks ?? null,
        missingDocuments: parsed.missingDocuments ?? null,
        expiringDocuments: parsed.expiringDocuments ?? null,
        medicalFlags: parsed.medicalFlags ?? null,
        overallStatus: parsed.overallStatus ?? "CONDITIONAL",
        overallScore: parsed.overallScore ?? null,
        summary: parsed.summary ?? null,
        recommendations: parsed.recommendations ?? null,
    })
        .returning();
    if (!row) {
        throw new AppError("INTERNAL_ERROR", "Failed to persist validation result.");
    }
    return row;
}
//# sourceMappingURL=validation.service.js.map