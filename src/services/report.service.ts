import { eq, desc } from "drizzle-orm";
import { db } from "../db/client.js";
import { extractions, validations, sessions } from "../db/schema.js";
import { AppError } from "../middleware/errorHandler.js";
import { deriveHealth, deriveRole } from "./session.service.js";
import { isExpiringSoon } from "../utils/dateUtils.js";

// ---------------------------------------------------------------------------
// Required document sets per role
// ---------------------------------------------------------------------------

const REQUIRED_DECK = [
  "COC", "SIRB", "PASSPORT", "PEME", "DRUG_TEST",
  "COP_BT", "COP_PSCRB", "COP_AFF", "ECDIS_GENERIC",
];
const REQUIRED_ENGINE = [
  "COC", "SIRB", "PASSPORT", "PEME", "DRUG_TEST",
  "COP_BT", "COP_PSCRB", "COP_AFF", "ERM",
];
const REQUIRED_BOTH = Array.from(new Set([...REQUIRED_DECK, ...REQUIRED_ENGINE]));

// Human-readable names for missing-document objects
const DOC_NAMES: Record<string, string> = {
  COC:          "Certificate of Competency",
  SIRB:         "Seaman's Identity and Record Book",
  PASSPORT:     "Passport",
  PEME:         "Pre-Employment Medical Examination",
  DRUG_TEST:    "Drug Test Certificate",
  COP_BT:       "Certificate of Proficiency — Basic Training",
  COP_PSCRB:    "Certificate of Proficiency — PSCRB",
  COP_AFF:      "Certificate of Proficiency — Advanced Fire Fighting",
  ECDIS_GENERIC:"ECDIS Generic Certificate",
  ERM:          "Engine Room Resource Management",
  COP_MECA:     "Certificate of Proficiency — Medical Care",
  COP_MEFA:     "Certificate of Proficiency — Medical First Aid",
  BRM_SSBT:     "Bridge Resource Management",
};

// Severity of each missing required doc
const DOC_SEVERITY: Record<string, "CRITICAL" | "HIGH" | "MEDIUM"> = {
  COC:          "CRITICAL",
  PEME:         "CRITICAL",
  SIRB:         "HIGH",
  PASSPORT:     "HIGH",
  DRUG_TEST:    "HIGH",
  COP_BT:       "HIGH",
  COP_PSCRB:    "HIGH",
  COP_AFF:      "MEDIUM",
  ECDIS_GENERIC:"MEDIUM",
  ERM:          "HIGH",
  COP_MECA:     "MEDIUM",
  COP_MEFA:     "MEDIUM",
  BRM_SSBT:     "MEDIUM",
};

// ---------------------------------------------------------------------------
// buildReport — derives everything from DB, no additional LLM calls
// ---------------------------------------------------------------------------

export async function buildReport(sessionId: string) {
  const sessionRow = await db.query.sessions.findFirst({
    where: eq(sessions.id, sessionId),
  });
  if (!sessionRow) {
    throw new AppError("SESSION_NOT_FOUND", `Session '${sessionId}' not found.`);
  }

  const [extractionRows, latestValidation] = await Promise.all([
    db.query.extractions.findMany({ where: eq(extractions.sessionId, sessionId) }),
    db.query.validations.findFirst({
      where: eq(validations.sessionId, sessionId),
      orderBy: [desc(validations.validatedAt)],
    }),
  ]);

  const detectedRole  = deriveRole(extractionRows);
  const overallHealth = deriveHealth(extractionRows);

  // ── Holder profile ─────────────────────────────────────────────────────────
  // Prefer the LLM's cross-document reconciled profile from validation.
  // Fall back to extracting per-holder data directly from extraction rows
  // when holderProfile is null (e.g. mixed-seafarer sessions where the LLM
  // skipped the field, or validation has not been run yet).

  const validationProfile = latestValidation?.holderProfile as
    | Record<string, unknown>
    | null;

  // Build a fallback profile by collecting the most complete holder data
  // across all extractions. For mixed sessions (BOTH role) we surface all
  // distinct holders so the Manning Agent can see who was checked.
  const holdersById = new Map<
    string,
    { name: string; dob: string | null; sirb: string | null; passport: string | null; role: string | null }
  >();
  for (const row of extractionRows) {
    if (!row.holderName) continue;
    const key = row.holderName.toUpperCase().trim();
    if (!holdersById.has(key)) {
      holdersById.set(key, {
        name:     row.holderName,
        dob:      row.dateOfBirth,
        sirb:     row.sirbNumber,
        passport: row.passportNumber,
        role:     row.applicableRole,
      });
    }
  }
  const distinctHolders = Array.from(holdersById.values());

  // Primary holder: prefer the one whose role matches detectedRole,
  // or the first one found for single-person sessions.
  const primaryHolder =
    distinctHolders.find(
      (h) => h.role?.toUpperCase() === detectedRole,
    ) ?? distinctHolders[0];

  const holderSummary =
    detectedRole === "BOTH"
      ? {
          // Mixed session: show all holders side by side
          holders: distinctHolders.map((h) => ({
            fullName:      h.name,
            dateOfBirth:   h.dob,
            sirbNumber:    h.sirb,
            passportNumber: h.passport,
            detectedRole:  h.role,
          })),
          detectedRole,
          note: "Session contains documents for multiple seafarers.",
        }
      : {
          // Single seafarer: flat profile, LLM data preferred
          fullName:
            (validationProfile?.["fullName"] as string | undefined) ??
            primaryHolder?.name ?? null,
          dateOfBirth:
            (validationProfile?.["dateOfBirth"] as string | undefined) ??
            primaryHolder?.dob ?? null,
          nationality:
            (validationProfile?.["nationality"] as string | undefined) ?? null,
          sirbNumber:
            (validationProfile?.["sirbNumber"] as string | undefined) ??
            primaryHolder?.sirb ?? null,
          passportNumber:
            (validationProfile?.["passportNumber"] as string | undefined) ??
            primaryHolder?.passport ?? null,
          rank:
            (validationProfile?.["rank"] as string | undefined) ?? null,
          detectedRole,
        };

  // ── Consistency checks ─────────────────────────────────────────────────────
  // Use LLM cross-doc checks if available; otherwise derive locally.
  const consistencyChecks =
    Array.isArray(latestValidation?.consistencyChecks) &&
    (latestValidation!.consistencyChecks as unknown[]).length > 0
      ? latestValidation!.consistencyChecks
      : deriveConsistencyChecks(extractionRows);

  // ── Document checklist ─────────────────────────────────────────────────────
  const requiredTypes =
    detectedRole === "DECK"    ? REQUIRED_DECK
    : detectedRole === "ENGINE" ? REQUIRED_ENGINE
    : REQUIRED_BOTH;

  // Map by documentType — keep the most recently created row per type
  const presentByType = new Map<string, typeof extractionRows[number]>();
  for (const row of [...extractionRows].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
  )) {
    if (row.documentType) presentByType.set(row.documentType, row);
  }

  const documentChecklist = requiredTypes.map((docType) => {
    const row = presentByType.get(docType);
    const validity = row?.validity as { dateOfExpiry?: string; daysUntilExpiry?: number } | null;
    const expiryRaw = validity?.dateOfExpiry ?? null;
    const expired    = row?.isExpired ?? false;
    const expiringSoon = expiryRaw ? isExpiringSoon(expiryRaw, 90) : false;
    const flags = Array.isArray(row?.flags)
      ? (row!.flags as Array<{ severity: string; message: string }>)
      : [];

    let status: string;
    if (!row)          status = "MISSING";
    else if (expired)  status = "EXPIRED";
    else if (expiringSoon) status = "EXPIRING_SOON";
    else               status = "PRESENT";

    return {
      documentType:     docType,
      documentName:     DOC_NAMES[docType] ?? docType,
      status,
      fileName:         row?.fileName ?? null,
      holderName:       row?.holderName ?? null,
      issuingAuthority:
        (row?.compliance as Record<string, unknown> | null)?.["issuingAuthority"] ?? null,
      expiryDate:       expiryRaw,
      daysUntilExpiry:  validity?.daysUntilExpiry ?? null,
      flags,
    };
  });

  // ── Medical summary ────────────────────────────────────────────────────────
  const peme = presentByType.get("PEME");
  const drug = presentByType.get("DRUG_TEST");
  const medicalData = peme?.medicalData as Record<string, unknown> | null;
  const drugData    = drug?.medicalData as Record<string, unknown> | null;
  const pemeValidity = peme?.validity as { dateOfExpiry?: string } | null;

  const medicalSummary = {
    fitnessResult:  (medicalData?.["fitnessResult"]  as string | undefined) ?? "N/A",
    drugTestResult: (drugData?.["drugTestResult"]    as string | undefined)
                 ?? (medicalData?.["drugTestResult"] as string | undefined) ?? "N/A",
    pemeExpiry:     pemeValidity?.dateOfExpiry ?? null,
    restrictions:   (medicalData?.["restrictions"]  as string | undefined) ?? null,
    specialNotes:   (medicalData?.["specialNotes"]  as string | undefined) ?? null,
  };

  // ── Missing required documents (structured objects) ────────────────────────
  // FIX: was returning plain string array; spec requires objects with
  // documentType, documentName, reason, severity.
  const missingDocuments = requiredTypes
    .filter((t) => !presentByType.has(t))
    .map((docType) => ({
      documentType: docType,
      documentName: DOC_NAMES[docType] ?? docType,
      reason:       `${DOC_NAMES[docType] ?? docType} not found in uploaded documents`,
      severity:     DOC_SEVERITY[docType] ?? "MEDIUM",
    }));

  // ── Compliance issues ──────────────────────────────────────────────────────
  // Aggregate: extraction-level flags + validation medical flags + missing required certs
  const complianceIssues: Array<{
    severity: string;
    source: string;
    message: string;
    recommendation: string;
  }> = [];

// From individual document flags — only MEDIUM and above are actionable
  const INFORMATIONAL_PATTERNS = [
    "not yet expired",
    "still valid",
    "is valid",
  ];

  for (const row of extractionRows) {
    const flags = Array.isArray(row.flags)
      ? (row.flags as Array<{ severity: string; message: string }>)
      : [];
    for (const flag of flags) {
      // Skip LOW-severity flags that are purely informational
      if (flag.severity === "LOW") continue;
      // Skip messages that confirm a good state rather than flag a problem
      const isInformational = INFORMATIONAL_PATTERNS.some((p) =>
        flag.message.toLowerCase().includes(p),
      );
      if (isInformational) continue;

      complianceIssues.push({
        severity:       flag.severity,
        source:         row.documentType ?? "UNKNOWN",
        message:        flag.message,
        recommendation: recommendationFor(flag.severity, flag.message),
      });
    }
  }

  // From cross-document medical flags in validation
  const validationMedicalFlags = latestValidation?.medicalFlags;
  if (Array.isArray(validationMedicalFlags)) {
    for (const flag of validationMedicalFlags as Array<{ severity: string; message: string }>) {
      complianceIssues.push({
        severity:       flag.severity,
        source:         "CROSS_DOCUMENT",
        message:        flag.message,
        recommendation: recommendationFor(flag.severity, flag.message),
      });
    }
  }

  // From missing required certs — these are always compliance issues
  // FIX: previously missing docs were not added here, leaving complianceIssues
  // empty even when CRITICAL certs were absent.
  for (const missing of missingDocuments) {
    complianceIssues.push({
      severity:       missing.severity,
      source:         "MISSING_DOCUMENT",
      message:        `Required document not found: ${missing.documentName}`,
      recommendation: recommendationFor(
        missing.severity,
        `Obtain and upload ${missing.documentName}`,
      ),
    });
  }

  // ── Expiring documents ─────────────────────────────────────────────────────
  const expiringDocuments = extractionRows
    .filter((row) => {
      const v = row.validity as { daysUntilExpiry?: number } | null;
      return (
        v?.daysUntilExpiry !== undefined &&
        v.daysUntilExpiry !== null &&
        v.daysUntilExpiry >= 0 &&
        v.daysUntilExpiry <= 90
      );
    })
    .map((row) => {
      const v = row.validity as { dateOfExpiry?: string; daysUntilExpiry?: number } | null;
      return {
        documentType:   row.documentType,
        documentName:   DOC_NAMES[row.documentType ?? ""] ?? row.documentType,
        fileName:       row.fileName,
        holderName:     row.holderName,
        expiryDate:     v?.dateOfExpiry ?? null,
        daysUntilExpiry: v?.daysUntilExpiry ?? null,
      };
    })
    .sort((a, b) => (a.daysUntilExpiry ?? 999) - (b.daysUntilExpiry ?? 999));

  // ── Overall score — recomputed server-side ─────────────────────────────────
  // FIX: LLM returned score=100 despite missing CRITICAL certs.
  // We recompute from all issues we actually found so the score is reliable.
  const DEDUCTIONS: Record<string, number> = {
    CRITICAL: 25, HIGH: 15, MEDIUM: 5, LOW: 2,
  };
  const computedScore = Math.max(
    0,
    100 - complianceIssues.reduce(
      (acc, issue) => acc + (DEDUCTIONS[issue.severity] ?? 0),
      0,
    ),
  );

  // ── Overall verdict ────────────────────────────────────────────────────────
  const verdictStatus =
    latestValidation?.overallStatus ??
    (overallHealth === "CRITICAL"
      ? "REJECTED"
      : overallHealth === "WARN" || missingDocuments.length > 0
      ? "CONDITIONAL"
      : "PENDING_VALIDATION");

  const verdictSummary =
    latestValidation?.summary ??
    `Session contains ${extractionRows.length} document(s) for a ${detectedRole} officer. ` +
    `Overall health: ${overallHealth}. ${missingDocuments.length} required document(s) missing.`;

  // ── Recommendations ────────────────────────────────────────────────────────
  // Prefer LLM recommendations if present; otherwise generate from issues.
  const llmRecs = Array.isArray(latestValidation?.recommendations)
    ? (latestValidation!.recommendations as string[]).filter(Boolean)
    : [];

  const recommendations =
    llmRecs.length > 0
      ? llmRecs
      : generateRecommendations(missingDocuments, expiringDocuments, medicalSummary);

  return {
    reportId:    crypto.randomUUID(),
    sessionId,
    generatedAt: new Date().toISOString(),
    holderSummary,
    overallVerdict: {
      status:  verdictStatus,
      score:   computedScore,
      health:  overallHealth,
      summary: verdictSummary,
    },
    documentChecklist,
    medicalSummary,
    complianceIssues: complianceIssues.sort(severityOrder),
    expiringDocuments,
    missingDocuments,
    consistencyChecks,
    recommendations,
    validationResult: latestValidation ?? null,
  };
}

// ---------------------------------------------------------------------------
// deriveConsistencyChecks — local fallback when LLM skipped the field
// ---------------------------------------------------------------------------

function deriveConsistencyChecks(
  rows: typeof extractions.$inferSelect[],
): Array<{
  field: string;
  status: string;
  values: string[];
  note: string | null;
}> {
  const fields: Array<{
    field: string;
    getter: (r: typeof rows[number]) => string | null;
  }> = [
    { field: "fullName",      getter: (r) => r.holderName },
    { field: "dateOfBirth",   getter: (r) => r.dateOfBirth },
    { field: "sirbNumber",    getter: (r) => r.sirbNumber },
    { field: "passportNumber",getter: (r) => r.passportNumber },
  ];

  return fields.map(({ field, getter }) => {
    const values = [
      ...new Set(
        rows
          .map(getter)
          .filter((v): v is string => v !== null && v !== undefined && v !== ""),
      ),
    ];

    const status =
      values.length === 0 ? "INSUFFICIENT_DATA"
      : values.length === 1 ? "CONSISTENT"
      : "INCONSISTENT";

    const note =
      status === "INCONSISTENT"
        ? `${values.length} different values found across documents`
        : null;

    return { field, status, values, note };
  });
}

// ---------------------------------------------------------------------------
// generateRecommendations — fallback when LLM recommendations are absent
// ---------------------------------------------------------------------------

function generateRecommendations(
  missing: Array<{ documentType: string; documentName: string; severity: string }>,
  expiring: Array<{ documentName: string | null | undefined; daysUntilExpiry: number | null }>,
  medical: { fitnessResult: string; drugTestResult: string },
): string[] {
  const recs: string[] = [];

  const criticalMissing = missing.filter((m) => m.severity === "CRITICAL");
  const highMissing     = missing.filter((m) => m.severity === "HIGH");

  if (criticalMissing.length > 0) {
    recs.push(
      `CRITICAL: Upload missing required documents before deployment — ${criticalMissing.map((m) => m.documentName).join(", ")}.`,
    );
  }
  if (highMissing.length > 0) {
    recs.push(
      `Obtain and upload: ${highMissing.map((m) => m.documentName).join(", ")}.`,
    );
  }
  for (const doc of expiring) {
    recs.push(
      `Renew ${doc.documentName ?? "document"} — expires in ${doc.daysUntilExpiry} day(s).`,
    );
  }
  if (medical.fitnessResult === "N/A") {
    recs.push("Upload a valid Pre-Employment Medical Examination (PEME).");
  }
  if (medical.drugTestResult === "N/A") {
    recs.push("Upload a valid Drug Test certificate.");
  }
  if (recs.length === 0) {
    recs.push("All required documents are present and valid. No immediate action required.");
  }

  return recs;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SEVERITY_RANK: Record<string, number> = {
  CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3,
};

function severityOrder(a: { severity: string }, b: { severity: string }): number {
  return (SEVERITY_RANK[a.severity] ?? 99) - (SEVERITY_RANK[b.severity] ?? 99);
}

function recommendationFor(severity: string, message: string): string {
  if (severity === "CRITICAL") {
    return `Immediate action required: ${message} must be resolved before deployment.`;
  }
  if (severity === "HIGH") {
    return `Urgent: address "${message}" before signing articles.`;
  }
  return `Review and resolve: ${message}`;
}