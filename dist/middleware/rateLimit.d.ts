/**
 * Rate limiting configuration helpers.
 *
 * @fastify/rate-limit is registered globally in app.ts with `global: false`
 * so each route opts in explicitly. The helpers here provide type-safe config
 * objects and keep limit values in one place.
 *
 * Limits come from environment variables (RATE_LIMIT_EXTRACT_RPM,
 * RATE_LIMIT_GENERAL_RPM) so they can be tuned without code changes.
 */
export declare function extractRateLimit(): {
    max: number;
    timeWindow: "1 minute";
};
export declare function generalRateLimit(): {
    max: number;
    timeWindow: "1 minute";
};
//# sourceMappingURL=rateLimit.d.ts.map