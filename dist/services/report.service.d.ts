export declare function buildReport(sessionId: string): Promise<{
    reportId: `${string}-${string}-${string}-${string}-${string}`;
    sessionId: string;
    generatedAt: string;
    holderSummary: {
        fullName: {} | null;
        dateOfBirth: {} | null;
        nationality: {} | null;
        sirbNumber: {} | null;
        passportNumber: {} | null;
        rank: {} | null;
        detectedRole: import("./session.service.js").DetectedRole;
    };
    overallVerdict: {
        status: string;
        score: number | null;
        health: import("./session.service.js").OverallHealth;
        summary: string;
    };
    documentChecklist: {
        documentType: string;
        status: string;
        fileName: string | null;
        issuingAuthority: {} | null;
        expiryDate: string | null;
        daysUntilExpiry: {} | null;
        flags: {
            severity: string;
            message: string;
        }[];
    }[];
    medicalSummary: {
        fitnessResult: {};
        drugTestResult: {};
        pemeExpiry: string | null;
        restrictions: {} | null;
        specialNotes: {} | null;
    };
    complianceIssues: {
        severity: string;
        source: string;
        message: string;
        recommendation: string;
    }[];
    expiringDocuments: {
        documentType: string | null;
        fileName: string;
        expiryDate: string | null;
        daysUntilExpiry: number | null;
    }[];
    missingDocuments: string[];
    recommendations: {};
    validationResult: {
        id: string;
        sessionId: string;
        summary: string | null;
        holderProfile: unknown;
        consistencyChecks: unknown;
        missingDocuments: unknown;
        expiringDocuments: unknown;
        medicalFlags: unknown;
        overallStatus: string;
        overallScore: number | null;
        recommendations: unknown;
        validatedAt: Date;
    } | null;
}>;
//# sourceMappingURL=report.service.d.ts.map