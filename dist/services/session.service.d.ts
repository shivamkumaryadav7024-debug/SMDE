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
export declare function createSession(): Promise<string>;
export declare function assertSessionExists(sessionId: string): Promise<void>;
export declare function getSessionDetail(sessionId: string): Promise<SessionDetail>;
/**
 * Majority-vote on applicable_role across all extractions.
 * Ties default to BOTH.
 */
export declare function deriveRole(rows: Array<{
    applicableRole: string | null;
}>): DetectedRole;
/**
 * Derive overall session health from extraction records.
 *
 * CRITICAL — any expired document OR any CRITICAL flag
 * WARN     — any MEDIUM/HIGH flag OR any cert expiring within 90 days
 * OK       — otherwise
 */
export declare function deriveHealth(rows: Array<{
    isExpired: boolean | null;
    flags: unknown;
    validity: unknown;
}>): OverallHealth;
//# sourceMappingURL=session.service.d.ts.map