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
import { config } from "../config.js";
export function extractRateLimit() {
    return {
        max: config.RATE_LIMIT_EXTRACT_RPM,
        timeWindow: "1 minute",
    };
}
export function generalRateLimit() {
    return {
        max: config.RATE_LIMIT_GENERAL_RPM,
        timeWindow: "1 minute",
    };
}
//# sourceMappingURL=rateLimit.js.map