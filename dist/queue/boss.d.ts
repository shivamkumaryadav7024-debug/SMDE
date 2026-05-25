import PgBoss from "pg-boss";
export declare const QUEUE_NAME = "document-extraction";
export interface ExtractionJobPayload {
    jobId: string;
    sessionId: string;
    fileName: string;
    filePath: string;
    mimeType: string;
    fileHash: string;
}
export declare function initBoss(): Promise<PgBoss>;
export declare function getBoss(): PgBoss;
export declare function pingQueue(): Promise<boolean>;
export declare function enqueueExtractionJob(payload: Omit<ExtractionJobPayload, "jobId"> & {
    sessionId: string;
}): Promise<string>;
//# sourceMappingURL=boss.d.ts.map