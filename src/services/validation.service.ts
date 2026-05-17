import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { extractions, validations } from "../db/schema.js";
import { getLLMProvider } from "../llm/factory.js";
import {
  buildValidationPrompt,
  type ExtractionSummary,
} from "../llm/prompt.js";
import { AppError } from "../middleware/errorHandler.js";
import { assertSessionExists } from "./session.service.js";

export interface ValidationResult {
  id: string;
  sessionId: string;
  holderProfile: unknown;
  consistencyChecks: unknown;
  missingDocuments: unknown;
  expiringDocuments: unknown;
  medicalFlags: unknown;
  overallStatus: string;
  overallScore: number | null;
  summary: string | null;
  recommendations: unknown;
  validatedAt: Date;
}

interface LLMValidationOutput {
  holderProfile?: unknown;
  consistencyChecks?: unknown;
  missingDocuments?: unknown;
  expiringDocuments?: unknown;
  medicalFlags?: unknown;
  overallStatus?: string;
  overallScore?: number;
  summary?: string;
  recommendations?: unknown;
}

export async function runValidation(
  sessionId: string,
): Promise<ValidationResult> {
  await assertSessionExists(sessionId);

  const extractionRows = await db.query.extractions.findMany({
    where: eq(extractions.sessionId, sessionId),
  });

  if (extractionRows.length < 2) {
    throw new AppError(
      "INSUFFICIENT_DOCUMENTS",
      "At least 2 documents are required to run compliance validation.",
    );
  }

  // Build the summary list to send to the LLM
  const summaries: ExtractionSummary[] = extractionRows.map((row) => ({
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

  // Single attempt — validation prompt is well-structured; no retry needed here
  const raw = await llm.extractDocument([], "text/plain", prompt);

  let parsed: LLMValidationOutput;
  try {
    parsed = JSON.parse(raw) as LLMValidationOutput;
  } catch {
    throw new AppError(
      "LLM_JSON_PARSE_FAIL",
      "Compliance validation failed: LLM returned an unparseable response.",
    );
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
    throw new AppError(
      "INTERNAL_ERROR",
      "Failed to persist validation result.",
    );
  }

  return row;
}
