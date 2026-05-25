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
export declare function runValidation(sessionId: string): Promise<ValidationResult>;
//# sourceMappingURL=validation.service.d.ts.map