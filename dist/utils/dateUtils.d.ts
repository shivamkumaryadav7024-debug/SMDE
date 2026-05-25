/**
 * Date utilities for certificate validity calculations.
 *
 * The LLM returns dates in various formats (DD/MM/YYYY, YYYY-MM-DD, free text).
 * These functions handle the common cases gracefully, returning null rather than
 * throwing when a date cannot be parsed.
 */
/**
 * Attempt to parse a date string returned by the LLM.
 * Handles DD/MM/YYYY and YYYY-MM-DD; returns null for unrecognised formats.
 */
export declare function parseDate(raw: string | null | undefined): Date | null;
/**
 * Number of whole days from now until the given expiry date.
 * Returns null for non-expiry strings (e.g. "Lifetime").
 * Returns a negative number if already expired.
 */
export declare function daysUntilExpiry(raw: string | null | undefined): number | null;
/**
 * Returns true if the document has expired (expiry date is in the past).
 * Returns false for documents with no expiry.
 */
export declare function isExpired(raw: string | null | undefined): boolean;
/**
 * Returns true if the document expires within the given number of days.
 */
export declare function isExpiringSoon(raw: string | null | undefined, withinDays?: number): boolean;
//# sourceMappingURL=dateUtils.d.ts.map