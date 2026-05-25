import { pgTable, uuid, text, boolean, integer, timestamp, jsonb, } from "drizzle-orm/pg-core";
// ---------------------------------------------------------------------------
// sessions
// ---------------------------------------------------------------------------
export const sessions = pgTable("sessions", {
    id: uuid("id").primaryKey().defaultRandom(),
    createdAt: timestamp("created_at", { withTimezone: true })
        .notNull()
        .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
        .notNull()
        .defaultNow(),
});
// ---------------------------------------------------------------------------
// extractions
// ---------------------------------------------------------------------------
export const extractions = pgTable("extractions", {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
        .notNull()
        .references(() => sessions.id, { onDelete: "cascade" }),
    jobId: uuid("job_id"),
    // File metadata
    fileName: text("file_name").notNull(),
    fileHash: text("file_hash").notNull(),
    mimeType: text("mime_type").notNull(),
    // LLM detection output
    documentType: text("document_type"),
    documentName: text("document_name"),
    applicableRole: text("applicable_role"),
    category: text("category"),
    confidence: text("confidence"),
    // Holder identity (promoted for quick querying)
    holderName: text("holder_name"),
    dateOfBirth: text("date_of_birth"),
    sirbNumber: text("sirb_number"),
    passportNumber: text("passport_number"),
    // Full structured LLM output stored as JSONB (schema evolves with document types)
    fields: jsonb("fields"),
    validity: jsonb("validity"),
    compliance: jsonb("compliance"),
    medicalData: jsonb("medical_data"),
    flags: jsonb("flags"),
    // Computed from validity dates at extraction time
    isExpired: boolean("is_expired"),
    summary: text("summary"),
    // Stored when LLM returns unparseable JSON — for debugging
    rawLlmResponse: text("raw_llm_response"),
    processingTimeMs: integer("processing_time_ms"),
    createdAt: timestamp("created_at", { withTimezone: true })
        .notNull()
        .defaultNow(),
});
// ---------------------------------------------------------------------------
// jobs  (async processing queue mirror — pg-boss owns execution,
//        this table owns the client-visible lifecycle)
// ---------------------------------------------------------------------------
export const jobs = pgTable("jobs", {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
        .notNull()
        .references(() => sessions.id, { onDelete: "cascade" }),
    extractionId: uuid("extraction_id"),
    status: text("status").notNull().default("QUEUED"),
    queuePosition: integer("queue_position"),
    // Error details
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    retryable: boolean("retryable"),
    // File info kept here so the worker can reconstruct the job after a restart
    fileName: text("file_name").notNull(),
    filePath: text("file_path").notNull(),
    mimeType: text("mime_type").notNull(),
    fileHash: text("file_hash").notNull(),
    // Lifecycle timestamps
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    failedAt: timestamp("failed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
        .notNull()
        .defaultNow(),
});
// ---------------------------------------------------------------------------
// validations  (cross-document compliance assessment results)
// ---------------------------------------------------------------------------
export const validations = pgTable("validations", {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
        .notNull()
        .references(() => sessions.id, { onDelete: "cascade" }),
    holderProfile: jsonb("holder_profile"),
    consistencyChecks: jsonb("consistency_checks"),
    missingDocuments: jsonb("missing_documents"),
    expiringDocuments: jsonb("expiring_documents"),
    medicalFlags: jsonb("medical_flags"),
    overallStatus: text("overall_status").notNull(),
    overallScore: integer("overall_score"),
    summary: text("summary"),
    recommendations: jsonb("recommendations"),
    validatedAt: timestamp("validated_at", { withTimezone: true })
        .notNull()
        .defaultNow(),
});
//# sourceMappingURL=schema.js.map