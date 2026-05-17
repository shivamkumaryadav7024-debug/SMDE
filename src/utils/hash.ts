import { createHash } from "crypto";

/**
 * Compute a SHA-256 hex digest of a buffer.
 * Used for deduplication: same file + same session → skip LLM call.
 */
export function computeSHA256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}
