import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { sessions, extractions, jobs } from "../db/schema.js";
import { AppError } from "../middleware/errorHandler.js";
import { isExpired, isExpiringSoon } from "../utils/dateUtils.js";

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
    throw new AppError(
      "SESSION_NOT_FOUND",
      `Session '${sessionId}' not found.`,
    );

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
 * Ties default to BOTH.
 */
export function deriveRole(
  rows: Array<{ applicableRole: string | null }>,
): DetectedRole {
  const counts: Record<string, number> = {
    DECK: 0,
    ENGINE: 0,
    BOTH: 0,
    "N/A": 0,
  };

  for (const row of rows) {
    const role = row.applicableRole?.toUpperCase();
    if (role && role in counts) {
      counts[role] = (counts[role] ?? 0) + 1;
    }
  }

  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const top = sorted[0];

  if (!top || top[1] === 0) return "N/A";

  // If DECK and ENGINE are tied, call it BOTH
  const deckCount = counts["DECK"] ?? 0;
  const engineCount = counts["ENGINE"] ?? 0;
  if (deckCount > 0 && engineCount > 0 && deckCount === engineCount)
    return "BOTH";

  return top[0] as DetectedRole;
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
