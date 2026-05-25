/**
 * Compute a SHA-256 hex digest of a buffer.
 * Used for deduplication: same file + same session → skip LLM call.
 */
export declare function computeSHA256(buffer: Buffer): string;
//# sourceMappingURL=hash.d.ts.map