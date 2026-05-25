import { eq, and } from "drizzle-orm";
import { db } from "../db/client.js";
import { extractions, type NewExtraction } from "../db/schema.js";
import { getLLMProvider } from "../llm/factory.js";
import { EXTRACTION_PROMPT } from "../llm/prompt.js";
import { computeSHA256 } from "../utils/hash.js";
import { daysUntilExpiry, isExpired } from "../utils/dateUtils.js";
import { AppError } from "../middleware/errorHandler.js";

export interface ExtractionParams {
  fileBuffer: Buffer;
  mimeType: string;
  fileName: string;
  sessionId: string;
  jobId?: string;
}

export interface ExtractionResult {
  id: string;
  sessionId: string;
  jobId: string | null;
  fileName: string;
  documentType: string | null;
  documentName: string | null;
  applicableRole: string | null;
  category: string | null;
  confidence: string | null;
  holderName: string | null;
  dateOfBirth: string | null;
  sirbNumber: string | null;
  passportNumber: string | null;
  fields: unknown;
  validity: unknown;
  compliance: unknown;
  medicalData: unknown;
  flags: unknown;
  isExpired: boolean | null;
  summary: string | null;
  processingTimeMs: number | null;
  createdAt: Date;
  isDuplicate?: boolean;
}

// Shape of a single document entry the LLM returns in the array
interface LLMDocumentEntry {
  detection?: {
    documentType?: string;
    documentName?: string;
    category?: string;
    applicableRole?: string;
    confidence?: string;
  };
  holder?: {
    fullName?: string;
    dateOfBirth?: string;
    sirbNumber?: string;
    passportNumber?: string;
    rank?: string;
  };
  fields?: unknown;
  validity?: {
    dateOfIssue?: string;
    dateOfExpiry?: string;
    isExpired?: boolean;
    daysUntilExpiry?: number | null;
    revalidationRequired?: boolean | null;
  };
  compliance?: unknown;
  medicalData?: unknown;
  flags?: unknown;
  summary?: string;
}

// ---------------------------------------------------------------------------
// JSON extraction helpers
// ---------------------------------------------------------------------------

/**
 * Extract the outermost JSON array or object from a raw LLM response string.
 *
 * Handles the three most common Groq/LLaMA failure modes:
 *   1. Response wrapped in ```json ... ``` fences
 *   2. Preamble prose before the JSON  ("Here is the data:\n[...")
 *   3. Trailing explanation after the closing bracket/brace
 *
 * We look for an array boundary first because our EXTRACTION_PROMPT
 * explicitly asks for a JSON array; the object fallback is a safety net.
 */
function extractJSON(raw: string): string | null {
  // Strip markdown code fences
  const stripped = raw
    .replace(/^```(?:json)?\s*/im, "")
    .replace(/\s*```\s*$/im, "")
    .trim();

  // Prefer outermost array
  const arrayStart = stripped.indexOf("[");
  const arrayEnd = stripped.lastIndexOf("]");
  if (arrayStart !== -1 && arrayEnd > arrayStart) {
    return stripped.slice(arrayStart, arrayEnd + 1);
  }

  // Fall back to outermost object (single-doc response)
  const objStart = stripped.indexOf("{");
  const objEnd = stripped.lastIndexOf("}");
  if (objStart !== -1 && objEnd > objStart) {
    return stripped.slice(objStart, objEnd + 1);
  }

  return null;
}

function parseResponse(raw: string): unknown {
  const extracted = extractJSON(raw);
  if (!extracted) {
    throw new SyntaxError("No JSON array or object found in LLM response");
  }
  return JSON.parse(extracted);
}

/**
 * Normalise the parsed LLM output to an array.
 * The prompt asks for an array, but guard against single-object responses.
 */
function normaliseToArray(parsed: unknown): LLMDocumentEntry[] {
  if (Array.isArray(parsed)) return parsed as LLMDocumentEntry[];
  if (parsed && typeof parsed === "object") return [parsed as LLMDocumentEntry];
  return [];
}

// ---------------------------------------------------------------------------
// Main extraction function
// ---------------------------------------------------------------------------

export async function runExtraction(
  params: ExtractionParams,
): Promise<ExtractionResult> {
  const { fileBuffer, mimeType, fileName, sessionId, jobId } = params;
  const startedAt = Date.now();

  // ── 1. Hash ──────────────────────────────────────────────────────────────
  const fileHash = computeSHA256(fileBuffer);

  // ── 2. Deduplication check ───────────────────────────────────────────────
  const existing = await db.query.extractions.findFirst({
    where: and(
      eq(extractions.sessionId, sessionId),
      eq(extractions.fileHash, fileHash),
    ),
  });

  if (existing) {
    return { ...rowToResult(existing), isDuplicate: true };
  }

  // ── 3. Build file parts for the LLM ─────────────────────────────────────
  const llmParts = [{ buffer: fileBuffer, mimeType }];
  const llm = await getLLMProvider();

  // ── 4. Call LLM — attempt 1: primary extraction ─────────────────────────
  let rawResponse = await llm.extractDocument(llmParts, EXTRACTION_PROMPT);
  let parsedArray: LLMDocumentEntry[] | null = null;

  try {
    parsedArray = normaliseToArray(parseResponse(rawResponse));
  } catch {
    // ── attempt 2: send a repair prompt with the raw response ────────────
    // We ask the LLM to clean up its own output rather than re-OCR the file.
    const repairPrompt =
      `The following text was supposed to be a valid JSON array of maritime ` +
      `document objects but could not be parsed. Extract and return ONLY the ` +
      `valid JSON array. No explanation, no markdown, no code fences — raw JSON only.\n\n` +
      rawResponse;

    try {
      const repairRaw = await llm.generateText(repairPrompt);
      rawResponse = repairRaw;
      parsedArray = normaliseToArray(parseResponse(repairRaw));
    } catch {
      // Both attempts failed — store the failed record for debugging, never silently drop.
      const [failedRow] = await db
        .insert(extractions)
        .values({
          sessionId,
          jobId: jobId ?? null,
          fileName,
          fileHash,
          mimeType,
          rawLlmResponse: rawResponse,
          processingTimeMs: Date.now() - startedAt,
          status: "FAILED",
        } satisfies NewExtraction)
        .returning({ id: extractions.id });

      throw new AppError(
        "LLM_JSON_PARSE_FAIL",
        "Document extraction failed after retry. The raw response has been stored for review.",
        failedRow?.id,
      );
    }
  }

  // ── 5. Guard against empty array ─────────────────────────────────────────
  if (!parsedArray || parsedArray.length === 0) {
    const [failedRow] = await db
      .insert(extractions)
      .values({
        sessionId,
        jobId: jobId ?? null,
        fileName,
        fileHash,
        mimeType,
        rawLlmResponse: rawResponse,
        processingTimeMs: Date.now() - startedAt,
        status: "FAILED",
      } satisfies NewExtraction)
      .returning({ id: extractions.id });

    throw new AppError(
      "LLM_JSON_PARSE_FAIL",
      "LLM returned an empty document array.",
      failedRow?.id,
    );
  }

  // ── 6. LOW confidence retry ───────────────────────────────────────────────
  // If the first detected document came back LOW confidence, retry once with
  // the file name and MIME type as additional hints.
  if (parsedArray[0]?.detection?.confidence === "LOW") {
    const focusedPrompt =
      `${EXTRACTION_PROMPT}\n\n` +
      `HINT: The file name is "${fileName}" and the MIME type is "${mimeType}". ` +
      `Use these as additional signals to improve document type detection.`;

    try {
      const retryRaw = await llm.extractDocument(llmParts, focusedPrompt);
      const retryArray = normaliseToArray(parseResponse(retryRaw));
      const retryConfidence = retryArray[0]?.detection?.confidence;

      if (retryConfidence === "HIGH" || retryConfidence === "MEDIUM") {
        parsedArray = retryArray;
        rawResponse = retryRaw;
      }
    } catch {
      // Keep original result — don't fail the whole job over a failed confidence retry
    }
  }

  // ── 7. Persist all detected documents ────────────────────────────────────
  // Maritime PDFs commonly bundle 10–20+ certificates in one file.
  // Each detected document becomes its own extraction row so the session
  // summary, validation, and report see every certificate individually.
  // We return the first row as the "primary" result for the job/sync response.
  const insertedRows: Array<typeof extractions.$inferSelect> = [];

  for (const doc of parsedArray) {
    const expiryRaw = doc.validity?.dateOfExpiry ?? null;
    const computedIsExpired = isExpired(expiryRaw);
    const computedDaysUntilExpiry = daysUntilExpiry(expiryRaw);

    const row: NewExtraction = {
      sessionId,
      jobId: jobId ?? null,
      fileName,
      fileHash,
      mimeType,
      documentType: doc.detection?.documentType ?? null,
      documentName: doc.detection?.documentName ?? null,
      applicableRole: doc.detection?.applicableRole ?? null,
      category: doc.detection?.category ?? null,
      confidence: doc.detection?.confidence ?? null,
      holderName: doc.holder?.fullName ?? null,
      dateOfBirth: doc.holder?.dateOfBirth ?? null,
      sirbNumber: doc.holder?.sirbNumber ?? null,
      passportNumber: doc.holder?.passportNumber ?? null,
      fields: doc.fields ?? null,
      validity: {
        ...(doc.validity ?? {}),
        isExpired: computedIsExpired,
        daysUntilExpiry: computedDaysUntilExpiry,
      },
      compliance: doc.compliance ?? null,
      medicalData: doc.medicalData ?? null,
      flags: doc.flags ?? null,
      isExpired: computedIsExpired,
      summary: doc.summary ?? null,
      rawLlmResponse: rawResponse,
      processingTimeMs: Date.now() - startedAt,
      status: "COMPLETE",
    };

    const [inserted] = await db.insert(extractions).values(row).returning();
    if (inserted) insertedRows.push(inserted);
  }

  const primaryRow = insertedRows[0];
  if (!primaryRow) {
    throw new AppError("INTERNAL_ERROR", "Failed to persist extraction record.");
  }

  return rowToResult(primaryRow);
}

// ── Helper: map DB row → ExtractionResult ────────────────────────────────────

function rowToResult(row: typeof extractions.$inferSelect): ExtractionResult {
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