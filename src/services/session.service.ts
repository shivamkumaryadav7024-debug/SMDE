import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { sessions, extractions, jobs } from "../db/schema.js";
import { AppError } from "../middleware/errorHandler.js";
import { isExpiringSoon } from "../utils/dateUtils.js";

export type OverallHealth = "OK" | "WARN" | "CRITICAL";
export type DetectedRole = "DECK" | "ENGINE" | "BOTH" | "N/A";

export interface SessionSummaryDocument {
  id: string;
  fileName: string;
  documentType: string | null;
  applicableRole: string | null;
  holderName: string | null;
  confidence: string | null;
  isExpired: boolean | null;
  flagCount: number;
  criticalFlagCount: number;
  createdAt: Date;
}

export interface SessionDetail {
  sessionId: string;
  documentCount: number;
  detectedRole: DetectedRole;
  overallHealth: OverallHealth;
  documents: SessionSummaryDocument[];
  pendingJobs: Array<{
    jobId: string;
    status: string;
    fileName: string;
    createdAt: Date;
  }>;
  createdAt: Date;
}

// ── Session CRUD ─────────────────────────────────────────────────────────────

export async function createSession(): Promise<string> {
  const [row] = await db
    .insert(sessions)
    .values({})
    .returning({ id: sessions.id });
  if (!row) throw new AppError("INTERNAL_ERROR", "Failed to create session.");
  return row.id;
}

export async function assertSessionExists(sessionId: string): Promise<void> {
  const row = await db.query.sessions.findFirst({
    where: eq(sessions.id, sessionId),
    columns: { id: true },
  });
  if (!row) {
    throw new AppError(
      "SESSION_NOT_FOUND",
      `Session '${sessionId}' not found.`,
    );
  }
}

export async function getSessionDetail(
  sessionId: string,
): Promise<SessionDetail> {
  await assertSessionExists(sessionId);

  const [sessionRow, extractionRows, jobRows] = await Promise.all([
    db.query.sessions.findFirst({ where: eq(sessions.id, sessionId) }),
    db.query.extractions.findMany({
      where: eq(extractions.sessionId, sessionId),
    }),
    db.query.jobs.findMany({ where: eq(jobs.sessionId, sessionId) }),
  ]);

  if (!sessionRow)
    throw new AppError("SESSION_NOT_FOUND", `Session '${sessionId}' not found.`);

  const documents: SessionSummaryDocument[] = extractionRows.map((row) => {
    const flags = Array.isArray(row.flags)
      ? (row.flags as Array<{ severity: string }>)
      : [];
    return {
      id: row.id,
      fileName: row.fileName,
      documentType: row.documentType,
      applicableRole: row.applicableRole,
      holderName: row.holderName,
      confidence: row.confidence,
      isExpired: row.isExpired,
      flagCount: flags.length,
      criticalFlagCount: flags.filter((f) => f.severity === "CRITICAL").length,
      createdAt: row.createdAt,
    };
  });

  const pendingJobs = jobRows
    .filter((j) => j.status === "QUEUED" || j.status === "PROCESSING")
    .map((j) => ({
      jobId: j.id,
      status: j.status,
      fileName: j.fileName,
      createdAt: j.createdAt,
    }));

  return {
    sessionId,
    documentCount: extractionRows.length,
    detectedRole: deriveRole(extractionRows),
    overallHealth: deriveHealth(extractionRows),
    documents,
    pendingJobs,
    createdAt: sessionRow.createdAt,
  };
}

// ── Derived fields ────────────────────────────────────────────────────────────

/**
 * Majority-vote on applicable_role across all extractions.
 *
 * FIX: Previously N/A votes from role-agnostic docs (PEME, DRUG_TEST) were
 * counted and could break ties between DECK and ENGINE. We now ignore N/A
 * votes entirely when at least one meaningful role (DECK or ENGINE) is present.
 *
 * Session with 3 DECK + 1 N/A + 3 ENGINE → BOTH (tied meaningful roles)
 * Session with 3 ENGINE + 3 N/A           → ENGINE (only meaningful role)
 * Session with all N/A                    → N/A
 */
export function deriveRole(
  rows: Array<{ applicableRole: string | null }>,
): DetectedRole {
  let deckCount = 0;
  let engineCount = 0;
  let bothCount = 0;

  for (const row of rows) {
    const role = row.applicableRole?.toUpperCase();
    if (role === "DECK")   deckCount++;
    else if (role === "ENGINE") engineCount++;
    else if (role === "BOTH")   bothCount++;
    // N/A intentionally ignored
  }

  const hasDeck   = deckCount + bothCount > 0;
  const hasEngine = engineCount + bothCount > 0;

  if (hasDeck && hasEngine) return "BOTH";
  if (hasDeck)   return "DECK";
  if (hasEngine) return "ENGINE";
  return "N/A";
}

/**
 * Derive overall session health from extraction records.
 *
 * CRITICAL — any expired document OR any CRITICAL flag
 * WARN     — any MEDIUM/HIGH flag OR any cert expiring within 90 days
 * OK       — otherwise
 */
export function deriveHealth(
  rows: Array<{
    isExpired: boolean | null;
    flags: unknown;
    validity: unknown;
  }>,
): OverallHealth {
  for (const row of rows) {
    if (row.isExpired) return "CRITICAL";
    const flags = Array.isArray(row.flags)
      ? (row.flags as Array<{ severity: string }>)
      : [];
    if (flags.some((f) => f.severity === "CRITICAL")) return "CRITICAL";
  }

  for (const row of rows) {
    const flags = Array.isArray(row.flags)
      ? (row.flags as Array<{ severity: string }>)
      : [];
    if (flags.some((f) => f.severity === "HIGH" || f.severity === "MEDIUM")) {
      return "WARN";
    }
    const validity = row.validity as { dateOfExpiry?: string } | null;
    if (validity?.dateOfExpiry && isExpiringSoon(validity.dateOfExpiry, 90)) {
      return "WARN";
    }
  }

  return "OK";
}