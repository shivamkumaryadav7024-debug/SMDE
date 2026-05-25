import { eq, desc } from "drizzle-orm";
import { db } from "../db/client.js";
import { extractions, validations, sessions } from "../db/schema.js";
import { AppError } from "../middleware/errorHandler.js";
import { deriveHealth, deriveRole } from "./session.service.js";
import { isExpiringSoon } from "../utils/dateUtils.js";
// Required document types per role — used for the document checklist
const REQUIRED_DECK = [
    "COC",
    "SIRB",
    "PASSPORT",
    "PEME",
    "DRUG_TEST",
    "COP_BT",
    "COP_PSCRB",
    "COP_AFF",
    "ECDIS_GENERIC",
];
const REQUIRED_ENGINE = [
    "COC",
    "SIRB",
    "PASSPORT",
    "PEME",
    "DRUG_TEST",
    "COP_BT",
    "COP_PSCRB",
    "COP_AFF",
    "ERM",
];
const REQUIRED_BOTH = Array.from(new Set([...REQUIRED_DECK, ...REQUIRED_ENGINE]));
export async function buildReport(sessionId) {
    const sessionRow = await db.query.sessions.findFirst({
        where: eq(sessions.id, sessionId),
    });
    if (!sessionRow) {
        throw new AppError("SESSION_NOT_FOUND", `Session '${sessionId}' not found.`);
    }
    const [extractionRows, latestValidation] = await Promise.all([
        db.query.extractions.findMany({
            where: eq(extractions.sessionId, sessionId),
        }),
        db.query.validations.findFirst({
            where: eq(validations.sessionId, sessionId),
            orderBy: [desc(validations.validatedAt)],
        }),
    ]);
    const detectedRole = deriveRole(extractionRows);
    const overallHealth = deriveHealth(extractionRows);
    // ── Holder profile ─────────────────────────────────────────────────────────
    // Derive from the most-recently created extraction that has holder data
    const holderSource = extractionRows
        .filter((r) => r.holderName)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
    const validationProfile = latestValidation?.holderProfile;
    const holderSummary = {
        fullName: validationProfile?.["fullName"] ?? holderSource?.holderName ?? null,
        dateOfBirth: validationProfile?.["dateOfBirth"] ?? holderSource?.dateOfBirth ?? null,
        nationality: validationProfile?.["nationality"] ?? null,
        sirbNumber: validationProfile?.["sirbNumber"] ?? holderSource?.sirbNumber ?? null,
        passportNumber: validationProfile?.["passportNumber"] ??
            holderSource?.passportNumber ??
            null,
        rank: validationProfile?.["rank"] ?? null,
        detectedRole,
    };
    // ── Document checklist ─────────────────────────────────────────────────────
    const requiredTypes = detectedRole === "DECK"
        ? REQUIRED_DECK
        : detectedRole === "ENGINE"
            ? REQUIRED_ENGINE
            : REQUIRED_BOTH;
    const presentByType = new Map(extractionRows
        .filter((r) => r.documentType)
        .map((r) => [r.documentType, r]));
    const documentChecklist = requiredTypes.map((docType) => {
        const row = presentByType.get(docType);
        const validity = row?.validity;
        const expiryRaw = validity?.dateOfExpiry ?? null;
        const expired = row?.isExpired ?? false;
        const expiringSoon = expiryRaw ? isExpiringSoon(expiryRaw, 90) : false;
        const flags = Array.isArray(row?.flags)
            ? row.flags
            : [];
        let status;
        if (!row)
            status = "MISSING";
        else if (expired)
            status = "EXPIRED";
        else if (expiringSoon)
            status = "EXPIRING_SOON";
        else
            status = "PRESENT";
        return {
            documentType: docType,
            status,
            fileName: row?.fileName ?? null,
            issuingAuthority: row?.compliance?.["issuingAuthority"] ?? null,
            expiryDate: expiryRaw,
            daysUntilExpiry: validity?.dateOfExpiry
                ? (row?.validity?.["daysUntilExpiry"] ?? null)
                : null,
            flags,
        };
    });
    // ── Medical summary ────────────────────────────────────────────────────────
    const peme = presentByType.get("PEME");
    const drug = presentByType.get("DRUG_TEST");
    const medicalRow = peme ?? drug;
    const medicalData = medicalRow?.medicalData;
    const pemeValidity = peme?.validity;
    const medicalSummary = {
        fitnessResult: medicalData?.["fitnessResult"] ?? "N/A",
        drugTestResult: drug?.medicalData?.["drugTestResult"] ?? "N/A",
        pemeExpiry: pemeValidity?.dateOfExpiry ?? null,
        restrictions: medicalData?.["restrictions"] ?? null,
        specialNotes: medicalData?.["specialNotes"] ?? null,
    };
    // ── Compliance issues (aggregate flags across all extractions) ─────────────
    const complianceIssues = [];
    for (const row of extractionRows) {
        const flags = Array.isArray(row.flags)
            ? row.flags
            : [];
        for (const flag of flags) {
            complianceIssues.push({
                severity: flag.severity,
                source: row.documentType ?? "UNKNOWN",
                message: flag.message,
                recommendation: recommendationFor(flag.severity, flag.message),
            });
        }
    }
    // Add cross-document issues from validation if available
    const validationMedicalFlags = latestValidation?.medicalFlags;
    if (Array.isArray(validationMedicalFlags)) {
        for (const flag of validationMedicalFlags) {
            complianceIssues.push({
                severity: flag.severity,
                source: "CROSS_DOCUMENT",
                message: flag.message,
                recommendation: recommendationFor(flag.severity, flag.message),
            });
        }
    }
    // ── Expiring documents ─────────────────────────────────────────────────────
    const expiringDocuments = extractionRows
        .filter((row) => {
        const validity = row.validity;
        return (validity?.daysUntilExpiry !== undefined &&
            validity.daysUntilExpiry !== null &&
            validity.daysUntilExpiry >= 0 &&
            validity.daysUntilExpiry <= 90);
    })
        .map((row) => {
        const validity = row.validity;
        return {
            documentType: row.documentType,
            fileName: row.fileName,
            expiryDate: validity?.dateOfExpiry ?? null,
            daysUntilExpiry: validity?.daysUntilExpiry ?? null,
        };
    });
    // ── Missing required documents ─────────────────────────────────────────────
    const missingDocuments = requiredTypes.filter((t) => !presentByType.has(t));
    // ── Overall verdict ────────────────────────────────────────────────────────
    const verdictStatus = latestValidation
        ? latestValidation.overallStatus
        : overallHealth === "CRITICAL"
            ? "REJECTED"
            : overallHealth === "WARN"
                ? "CONDITIONAL"
                : missingDocuments.length > 0
                    ? "CONDITIONAL"
                    : "PENDING_VALIDATION";
    const verdictSummary = latestValidation?.summary ??
        `Session contains ${extractionRows.length} document(s) for a ${detectedRole} officer. ` +
            `Overall health: ${overallHealth}. ${missingDocuments.length} required document(s) missing.`;
    return {
        reportId: crypto.randomUUID(),
        sessionId,
        generatedAt: new Date().toISOString(),
        holderSummary,
        overallVerdict: {
            status: verdictStatus,
            score: latestValidation?.overallScore ?? null,
            health: overallHealth,
            summary: verdictSummary,
        },
        documentChecklist,
        medicalSummary,
        complianceIssues: complianceIssues.sort(severityOrder),
        expiringDocuments,
        missingDocuments,
        recommendations: latestValidation?.recommendations ?? [],
        validationResult: latestValidation ?? null,
    };
}
// ── Helpers ───────────────────────────────────────────────────────────────────
const SEVERITY_RANK = {
    CRITICAL: 0,
    HIGH: 1,
    MEDIUM: 2,
    LOW: 3,
};
function severityOrder(a, b) {
    return (SEVERITY_RANK[a.severity] ?? 99) - (SEVERITY_RANK[b.severity] ?? 99);
}
function recommendationFor(severity, message) {
    if (severity === "CRITICAL") {
        return `Immediate action required: ${message} must be resolved before deployment.`;
    }
    if (severity === "HIGH") {
        return `Urgent: address "${message}" before signing articles.`;
    }
    return `Review and resolve: ${message}`;
}
//# sourceMappingURL=report.service.js.map