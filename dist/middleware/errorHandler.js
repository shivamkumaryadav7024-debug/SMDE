// Map our internal error codes to HTTP status codes
const ERROR_STATUS_MAP = {
    UNSUPPORTED_FORMAT: 400,
    INSUFFICIENT_DOCUMENTS: 400,
    FILE_TOO_LARGE: 413,
    SESSION_NOT_FOUND: 404,
    JOB_NOT_FOUND: 404,
    LLM_JSON_PARSE_FAIL: 422,
    LLM_QUOTA_EXCEEDED: 429,
    LLM_FILE_UPLOAD_FAILED: 502,
    RATE_LIMITED: 429,
    INTERNAL_ERROR: 500,
};
export class AppError extends Error {
    code;
    extractionId;
    retryAfterMs;
    constructor(code, message, extractionId, retryAfterMs) {
        super(message);
        this.code = code;
        this.extractionId = extractionId;
        this.retryAfterMs = retryAfterMs;
        this.name = "AppError";
    }
}
export function errorHandler(error, _request, reply) {
    // File size limit from @fastify/multipart
    if ("code" in error && error.code === "FST_REQ_FILE_TOO_LARGE") {
        return reply.status(413).send({
            error: "FILE_TOO_LARGE",
            message: "File exceeds the 10MB size limit.",
            extractionId: null,
            retryAfterMs: null,
        });
    }
    // Rate limit error from @fastify/rate-limit
    if ("statusCode" in error && error.statusCode === 429) {
        return reply.status(429).send({
            error: "RATE_LIMITED",
            message: "Too many requests. Please slow down.",
            extractionId: null,
            retryAfterMs: error.retryAfter
                ? error.retryAfter * 1000
                : null,
        });
    }
    if (error instanceof AppError) {
        const status = ERROR_STATUS_MAP[error.code] ?? 500;
        return reply.status(status).send({
            error: error.code,
            message: error.message,
            extractionId: error.extractionId ?? null,
            retryAfterMs: error.retryAfterMs ?? null,
        });
    }
    // Fastify validation errors (400)
    if ("statusCode" in error && error.statusCode === 400) {
        return reply.status(400).send({
            error: "BAD_REQUEST",
            message: error.message,
            extractionId: null,
            retryAfterMs: null,
        });
    }
    // Catch-all
    console.error("[errorHandler] Unhandled error:", error);
    return reply.status(500).send({
        error: "INTERNAL_ERROR",
        message: "An unexpected error occurred.",
        extractionId: null,
        retryAfterMs: null,
    });
}
//# sourceMappingURL=errorHandler.js.map