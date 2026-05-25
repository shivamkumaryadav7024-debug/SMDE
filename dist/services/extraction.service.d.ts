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
export declare function runExtraction(params: ExtractionParams): Promise<ExtractionResult>;
//# sourceMappingURL=extraction.service.d.ts.map