/**
 * Date utilities for certificate validity calculations.
 *
 * The LLM returns dates in various formats (DD/MM/YYYY, YYYY-MM-DD, free text).
 * These functions handle the common cases gracefully, returning null rather than
 * throwing when a date cannot be parsed.
 */

const NON_EXPIRY_VALUES = new Set([
  "no expiry",
  "lifetime",
  "does not expire",
  "n/a",
  "none",
]);

/**
 * Attempt to parse a date string returned by the LLM.
 * Handles DD/MM/YYYY and YYYY-MM-DD; returns null for unrecognised formats.
 */
export function parseDate(raw: string | null | undefined): Date | null {
  if (!raw) return null;

  const trimmed = raw.trim();

  if (NON_EXPIRY_VALUES.has(trimmed.toLowerCase())) return null;

  // DD/MM/YYYY
  const dmyMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dmyMatch) {
    const [, d, m, y] = dmyMatch;
    const date = new Date(Number(y), Number(m) - 1, Number(d));
    return isNaN(date.getTime()) ? null : date;
  }

  // YYYY-MM-DD (ISO)
  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    const date = new Date(trimmed);
    return isNaN(date.getTime()) ? null : date;
  }

  // MM/YYYY (month + year only — treat as last day of that month)
  const myMatch = trimmed.match(/^(\d{1,2})\/(\d{4})$/);
  if (myMatch) {
    const [, m, y] = myMatch;
    const date = new Date(Number(y), Number(m), 0); // day 0 = last day of previous month
    return isNaN(date.getTime()) ? null : date;
  }

  // Last-resort: let JS try it
  const fallback = new Date(trimmed);
  return isNaN(fallback.getTime()) ? null : fallback;
}

/**
 * Number of whole days from now until the given expiry date.
 * Returns null for non-expiry strings (e.g. "Lifetime").
 * Returns a negative number if already expired.
 */
export function daysUntilExpiry(raw: string | null | undefined): number | null {
  if (!raw) return null;

  if (NON_EXPIRY_VALUES.has(raw.trim().toLowerCase())) return null;

  const expiry = parseDate(raw);
  if (!expiry) return null;

  const now = new Date();
  now.setHours(0, 0, 0, 0);
  expiry.setHours(0, 0, 0, 0);

  return Math.floor((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

/**
 * Returns true if the document has expired (expiry date is in the past).
 * Returns false for documents with no expiry.
 */
export function isExpired(raw: string | null | undefined): boolean {
  const days = daysUntilExpiry(raw);
  if (days === null) return false; // no expiry = never expired
  return days < 0;
}

/**
 * Returns true if the document expires within the given number of days.
 */
export function isExpiringSoon(
  raw: string | null | undefined,
  withinDays = 90,
): boolean {
  const days = daysUntilExpiry(raw);
  if (days === null) return false;
  return days >= 0 && days <= withinDays;
}
