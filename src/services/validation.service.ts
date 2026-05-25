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

// ---------------------------------------------------------------------------
// Human-readable names used to fill documentName when LLM returns null
// ---------------------------------------------------------------------------

const DOC_NAMES: Record<string, string> = {
  COC:           "Certificate of Competency",
  SIRB:          "Seaman's Identity and Record Book",
  PASSPORT:      "Passport",
  PEME:          "Pre-Employment Medical Examination",
  DRUG_TEST:     "Drug Test Certificate",
  COP_BT:        "Certificate of Proficiency — Basic Training",
  COP_PSCRB:     "Certificate of Proficiency — PSCRB",
  COP_AFF:       "Certificate of Proficiency — Advanced Fire Fighting",
  COP_MECA:      "Certificate of Proficiency — Medical Care",
  COP_MEFA:      "Certificate of Proficiency — Medical First Aid",
  COP_SSO:       "Certificate of Proficiency — Ship Security Officer",
  COP_SDSD:      "Certificate of Proficiency — SDSD",
  ECDIS_GENERIC: "ECDIS Generic Certificate",
  ECDIS_TYPE:    "ECDIS Type-Specific Certificate",
  ERM:           "Engine Room Resource Management",
  BRM_SSBT:      "Bridge Resource Management",
  MARPOL:        "MARPOL Certificate",
  SULPHUR_CAP:   "Sulphur Cap Certificate",
  BALLAST_WATER: "Ballast Water Management Certificate",
  HATCH_COVER:   "Hatch Cover Certificate",
  YELLOW_FEVER:  "Yellow Fever Vaccination Certificate",
  HAZMAT:        "Hazardous Materials Certificate",
  FLAG_STATE:    "Flag State Certificate",
  TRAIN_TRAINER: "Train the Trainer Certificate",
};

// ---------------------------------------------------------------------------
// Known validation object keys — used by reconstructObject
// ---------------------------------------------------------------------------

const VALIDATION_KEYS = [
  "holderProfile",
  "consistencyChecks",
  "missingDocuments",
  "expiringDocuments",
  "medicalFlags",
  "overallStatus",
  "overallScore",
  "summary",
  "recommendations",
] as const;

// ---------------------------------------------------------------------------
// extractValidationJSON
//
// The LLM (llama-3.1-8b-instant) frequently outputs the validation response
// WITHOUT the enclosing { } — it starts directly with a field value e.g.:
//
//   [                          ← this is consistencyChecks, not the root object
//     {"field": "fullName", ...}
//   ],
//   "missingDocuments": [...],
//   ...
//
// The old simple extractJSON preferred { } first, which failed because there
// was no root object. This version handles three cases:
//
//   1. Response is already a valid complete object  → return as-is
//   2. Fragment missing outer {}                    → reconstructObject()
//   3. Neither works                                → return null
// ---------------------------------------------------------------------------

function extractValidationJSON(raw: string): string | null {
  const stripped = raw
    .replace(/^```(?:json)?\s*/im, "")
    .replace(/\s*```\s*$/im, "")
    .trim();

  // Case 1: try outermost { } first
  const objStart = stripped.indexOf("{");
  const objEnd   = stripped.lastIndexOf("}");
  if (objStart !== -1 && objEnd > objStart) {
    const candidate = stripped.slice(objStart, objEnd + 1);
    try {
      JSON.parse(candidate);
      return candidate; // valid complete object
    } catch {
      // malformed — fall through to structural repair
    }
  }

  // Case 2: fragment without enclosing braces — reconstruct from known keys
  const reconstructed = reconstructObject(stripped);
  if (reconstructed) {
    try {
      JSON.parse(reconstructed);
      return reconstructed;
    } catch {
      // reconstruction produced invalid JSON — fall through
    }
  }

  return null;
}

/**
 * Scan text for known validation keys, extract each value by tracking
 * brace/bracket depth, and reassemble into a valid { } object.
 *
 * This handles the case where llama outputs all the right data but omits
 * the outer braces — every key: value pair is there, just unwrapped.
 */
function reconstructObject(text: string): string | null {
  const pairs: string[] = [];

  for (const key of VALIDATION_KEYS) {
    const pattern = `"${key}"`;
    const keyIdx = text.indexOf(pattern);
    if (keyIdx === -1) continue;

    const colonIdx = text.indexOf(":", keyIdx + pattern.length);
    if (colonIdx === -1) continue;

    let valueStart = colonIdx + 1;
    while (valueStart < text.length && /\s/.test(text[valueStart]!)) valueStart++;
    if (valueStart >= text.length) continue;

    const valueEnd = findValueEnd(text, valueStart);
    if (valueEnd === -1) continue;

    pairs.push(`"${key}": ${text.slice(valueStart, valueEnd + 1).trim()}`);
  }

  if (pairs.length === 0) return null;
  return `{${pairs.join(", ")}}`;
}

function findValueEnd(text: string, start: number): number {
  const ch = text[start];
  if (ch === undefined) return -1;

  // String
  if (ch === '"') {
    let i = start + 1;
    while (i < text.length) {
      if (text[i] === '\\') { i += 2; continue; }
      if (text[i] === '"') return i;
      i++;
    }
    return -1;
  }

  // Array or object — track nesting depth
  if (ch === '[' || ch === '{') {
    const open  = ch;
    const close = ch === '[' ? ']' : '}';
    let depth = 1;
    let inStr = false;
    let i = start + 1;
    while (i < text.length) {
      const c = text[i]!;
      if (inStr) {
        if (c === '\\') { i += 2; continue; }
        if (c === '"') inStr = false;
      } else {
        if (c === '"')        inStr = true;
        else if (c === open)  depth++;
        else if (c === close) { depth--; if (depth === 0) return i; }
      }
      i++;
    }
    return -1;
  }

  // Number, boolean, null — read until delimiter
  let i = start;
  while (i < text.length && !/[,\}\]\s]/.test(text[i]!)) i++;
  return i - 1;
}

function parseValidationResponse(raw: string): LLMValidationOutput {
  const extracted = extractValidationJSON(raw);
  if (!extracted) {
    throw new SyntaxError("No parseable JSON object found in LLM validation response");
  }
  return JSON.parse(extracted) as LLMValidationOutput;
}

// ---------------------------------------------------------------------------
// sanitiseParsed — fix common LLM output quality issues before persisting
//
// Issues seen in production with llama-3.1-8b-instant:
//   1. medicalFlags with message: null or message: "" — phantom placeholders
//      that leak into report complianceIssues as "message: null"
//   2. medicalFlags with severity: "N/A" — not a valid severity enum value
//   3. missingDocuments with documentName: null — fill from DOC_NAMES map
//   4. missingDocuments as plain string array instead of objects — normalise
//   5. consistencyChecks with empty-string values — filter them out
// ---------------------------------------------------------------------------

function sanitiseParsed(parsed: LLMValidationOutput): LLMValidationOutput {
  // 1 & 2. Strip bad medical flags
  if (Array.isArray(parsed.medicalFlags)) {
    parsed.medicalFlags = (
      parsed.medicalFlags as Array<{ severity: string; message: string | null }>
    ).filter(
      (f) =>
        f.message !== null &&
        f.message !== undefined &&
        f.message.trim() !== "" &&
        f.severity !== "N/A",
    );
  }

  // 3 & 4. Normalise missingDocuments
  if (Array.isArray(parsed.missingDocuments)) {
    parsed.missingDocuments = (parsed.missingDocuments as unknown[]).map((doc) => {
      // Plain string → object
      if (typeof doc === "string") {
        return {
          documentType: doc,
          documentName: DOC_NAMES[doc] ?? doc,
          reason:       `${DOC_NAMES[doc] ?? doc} not found in uploaded documents`,
          severity:     "HIGH",
        };
      }
      // Object with null/empty documentName → fill from map
      const d = doc as { documentType?: string; documentName?: string | null; reason?: string; severity?: string };
      return {
        ...d,
        documentName:
          d.documentName && d.documentName.trim() !== ""
            ? d.documentName
            : (DOC_NAMES[d.documentType ?? ""] ?? d.documentType ?? "Unknown"),
      };
    });
  }

  // 5. Strip empty-string values from consistencyChecks
  if (Array.isArray(parsed.consistencyChecks)) {
    parsed.consistencyChecks = (
      parsed.consistencyChecks as Array<{ field: string; status: string; values: unknown[]; note: unknown }>
    ).map((check) => ({
      ...check,
      values: (check.values ?? []).filter(
        (v) => v !== null && v !== undefined && v !== "",
      ),
    }));
  }

  return parsed;
}

// ---------------------------------------------------------------------------
// deriveHolderProfile — local fallback when LLM returns null
// ---------------------------------------------------------------------------

function deriveHolderProfile(
  summaries: ExtractionSummary[],
): Record<string, unknown> {
  const byName = new Map<
    string,
    { name: string; dob: string | null; sirb: string | null; passport: string | null; role: string | null }
  >();

  for (const s of summaries) {
    if (!s.holderName) continue;
    const key = s.holderName.toUpperCase().trim();
    if (!byName.has(key)) {
      byName.set(key, {
        name:     s.holderName,
        dob:      s.dateOfBirth,
        sirb:     s.sirbNumber,
        passport: s.passportNumber,
        role:     s.applicableRole,
      });
    }
  }

  const holders = Array.from(byName.values());
  const meaningful = summaries
    .map((s) => s.applicableRole?.toUpperCase())
    .filter((r): r is string => !!r && r !== "N/A");

  const hasDeck   = meaningful.some((r) => r === "DECK"   || r === "BOTH");
  const hasEngine = meaningful.some((r) => r === "ENGINE" || r === "BOTH");
  const detectedRole =
    hasDeck && hasEngine ? "BOTH" : hasDeck ? "DECK" : hasEngine ? "ENGINE" : "N/A";

  if (holders.length === 1) {
    const h = holders[0]!;
    return {
      fullName:       h.name,
      dateOfBirth:    h.dob,
      nationality:    null,
      sirbNumber:     h.sirb,
      passportNumber: h.passport,
      rank:           null,
      detectedRole,
    };
  }

  return {
    holders: holders.map((h) => ({
      fullName:       h.name,
      dateOfBirth:    h.dob,
      sirbNumber:     h.sirb,
      passportNumber: h.passport,
      detectedRole:   h.role,
    })),
    detectedRole,
    note: "Session contains documents for multiple seafarers.",
  };
}

// ---------------------------------------------------------------------------
// deriveConsistencyChecks — local fallback when LLM returns null
// ---------------------------------------------------------------------------

function deriveConsistencyChecks(
  summaries: ExtractionSummary[],
): Array<{ field: string; status: string; values: string[]; note: string | null }> {
  const fields: Array<{ field: string; getter: (s: ExtractionSummary) => string | null | undefined }> = [
    { field: "fullName",       getter: (s) => s.holderName },
    { field: "dateOfBirth",    getter: (s) => s.dateOfBirth },
    { field: "sirbNumber",     getter: (s) => s.sirbNumber },
    { field: "passportNumber", getter: (s) => s.passportNumber },
  ];

  return fields.map(({ field, getter }) => {
    const values = [
      ...new Set(
        summaries
          .map(getter)
          .filter((v): v is string => v !== null && v !== undefined && v !== ""),
      ),
    ];

    const status =
      values.length === 0 ? "INSUFFICIENT_DATA"
      : values.length === 1 ? "CONSISTENT"
      : "INCONSISTENT";

    return {
      field,
      status,
      values,
      note: status === "INCONSISTENT"
        ? `${values.length} different values found across documents`
        : null,
    };
  });
}

// ---------------------------------------------------------------------------
// sleep + generateWithRetry — rate-limit backoff from your current file
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function generateWithRetry(
  generateFn: () => Promise<string>,
  label: string,
): Promise<string> {
  try {
    return await generateFn();
  } catch (err: unknown) {
    if (
      err instanceof Error &&
      "code" in err &&
      (err as { code: string }).code === "LLM_QUOTA_EXCEEDED" &&
      "retryAfterMs" in err
    ) {
      const waitMs = (err as { retryAfterMs?: number }).retryAfterMs ?? 60_000;
      console.warn(`[validation] ${label} — rate limited, waiting ${waitMs}ms before retry...`);
      await sleep(waitMs);
      return await generateFn();
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// toSlimSummary — reduce rows to only what the LLM needs
// ---------------------------------------------------------------------------

function toSlimSummary(row: typeof extractions.$inferSelect): ExtractionSummary {
  const validity    = row.validity    as Record<string, unknown> | null;
  const medicalData = row.medicalData as Record<string, unknown> | null;
  const compliance  = row.compliance  as Record<string, unknown> | null;
  const allFlags    = Array.isArray(row.flags)
    ? (row.flags as Array<{ severity: string; message: string }>)
    : [];

  return {
    id:             row.id,
    documentType:   row.documentType,
    documentName:   row.documentName,
    applicableRole: row.applicableRole,
    holderName:     row.holderName,
    dateOfBirth:    row.dateOfBirth,
    sirbNumber:     row.sirbNumber,
    passportNumber: row.passportNumber,
    validity: validity
      ? {
          dateOfExpiry:    validity["dateOfExpiry"]    ?? null,
          isExpired:       validity["isExpired"]        ?? null,
          daysUntilExpiry: validity["daysUntilExpiry"]  ?? null,
        }
      : null,
    compliance: compliance
      ? {
          issuingAuthority:    compliance["issuingAuthority"]    ?? null,
          regulationReference: compliance["regulationReference"] ?? null,
        }
      : null,
    medicalData: medicalData
      ? {
          fitnessResult:  medicalData["fitnessResult"]  ?? null,
          drugTestResult: medicalData["drugTestResult"] ?? null,
          restrictions:   medicalData["restrictions"]   ?? null,
          expiryDate:     medicalData["expiryDate"]     ?? null,
        }
      : null,
    flags:     allFlags.filter((f) => f.severity === "CRITICAL" || f.severity === "HIGH"),
    isExpired: row.isExpired,
    summary:   null,
  };
}

// ---------------------------------------------------------------------------
// runValidation — main entry point
// ---------------------------------------------------------------------------

export async function runValidation(
  sessionId: string,
): Promise<ValidationResult> {
  await assertSessionExists(sessionId);

  const extractionRows = await db.query.extractions.findMany({
    where: eq(extractions.sessionId, sessionId),
  });

  const completedRows = extractionRows.filter((r) => r.documentType !== null);

  if (completedRows.length < 2) {
    throw new AppError(
      "INSUFFICIENT_DOCUMENTS",
      "At least 2 successfully extracted documents are required to run compliance validation.",
    );
  }

  const summaries: ExtractionSummary[] = completedRows.map(toSlimSummary);
  const prompt = buildValidationPrompt(summaries);

  console.log(
    `[validation] ${summaries.length} docs, prompt: ${prompt.length} chars ≈ ${Math.round(prompt.length / 4)} tokens`,
  );

  const llm = await getLLMProvider();

  // ── Attempt 1: primary call ───────────────────────────────────────────────
  const raw = await generateWithRetry(
    () => llm.generateText(prompt),
    "primary call",
  );
  console.log(`[validation] Raw LLM response (first 500 chars): ${raw.slice(0, 500)}`);

  let parsed: LLMValidationOutput;

  try {
    parsed = parseValidationResponse(raw);
    console.log("[validation] ✅ Parse attempt 1 succeeded");
  } catch (e1) {
    console.warn(`[validation] Parse attempt 1 failed: ${String(e1)}`);
    console.warn(`[validation] Full raw response:\n${raw}`);

    // ── Attempt 2: LLM repair prompt ─────────────────────────────────────
    // Send ONLY the broken fragment — not the full original prompt —
    // so the model has maximum token budget to fix it.
    const repairPrompt =
      `The text below is an incomplete or malformed JSON object for a maritime ` +
      `compliance validation result. Fix it and return ONLY a single valid JSON ` +
      `object starting with { and ending with }. ` +
      `No markdown. No code fences. No explanation.\n\n` +
      raw;

    try {
      const repairRaw = await generateWithRetry(
        () => llm.generateText(repairPrompt),
        "repair call",
      );
      console.log(`[validation] Repair raw (first 500): ${repairRaw.slice(0, 500)}`);
      parsed = parseValidationResponse(repairRaw);
      console.log("[validation] ✅ LLM repair succeeded");
    } catch (e2) {
      console.error(`[validation] All parse attempts failed: ${String(e2)}`);
      throw new AppError(
        "LLM_JSON_PARSE_FAIL",
        "Compliance validation failed: LLM returned an unparseable response after repair attempt.",
      );
    }
  }

  // ── Sanitise LLM output quality issues ───────────────────────────────────
  parsed = sanitiseParsed(parsed);

  // ── Local fallbacks for fields the LLM reliably skips ────────────────────
  if (!parsed.holderProfile) {
    console.log("[validation] holderProfile null — deriving locally");
    parsed.holderProfile = deriveHolderProfile(summaries);
  }

  if (
    !parsed.consistencyChecks ||
    !Array.isArray(parsed.consistencyChecks) ||
    (parsed.consistencyChecks as unknown[]).length === 0
  ) {
    console.log("[validation] consistencyChecks null/empty — deriving locally");
    parsed.consistencyChecks = deriveConsistencyChecks(summaries);
  }

  console.log(
    `[validation] Final — status=${parsed.overallStatus} score=${parsed.overallScore}`,
  );

  // ── Persist ───────────────────────────────────────────────────────────────
  const [row] = await db
    .insert(validations)
    .values({
      sessionId,
      holderProfile:     parsed.holderProfile     ?? null,
      consistencyChecks: parsed.consistencyChecks ?? null,
      missingDocuments:  parsed.missingDocuments   ?? null,
      expiringDocuments: parsed.expiringDocuments  ?? null,
      medicalFlags:      parsed.medicalFlags       ?? null,
      overallStatus:     parsed.overallStatus      ?? "CONDITIONAL",
      overallScore:      parsed.overallScore       ?? null,
      summary:           parsed.summary            ?? null,
      recommendations:   parsed.recommendations    ?? null,
    })
    .returning();

  if (!row) {
    throw new AppError("INTERNAL_ERROR", "Failed to persist validation result.");
  }

  return row;
}