import Groq from "groq-sdk";
import { AppError } from "../middleware/errorHandler.js";
import type { LLMProvider } from "./provider.interface.js";
import * as fs from "fs";
import { execSync } from "child_process";
import Tesseract from "tesseract.js";

// ---------------------------------------------------------------------------
// Binary resolution — checks all common paths on macOS and Linux.
// ---------------------------------------------------------------------------

function findBinary(name: string): string | null {
  const candidates = [
    `/opt/homebrew/bin/${name}`, // macOS Apple Silicon (Homebrew)
    `/usr/local/bin/${name}`,    // macOS Intel (Homebrew)
    `/usr/bin/${name}`,          // Linux
    `/bin/${name}`,              // Linux fallback
  ];
  for (const p of candidates) {
    try { fs.accessSync(p, fs.constants.X_OK); return p; } catch {}
  }
  try {
    const p = execSync(`which ${name} 2>/dev/null`, { encoding: "utf-8" }).trim();
    if (p) return p;
  } catch {}
  return null;
}

const PDFTOTEXT = findBinary("pdftotext");
const PDFTOPPM  = findBinary("pdftoppm");

console.log(`[groq] pdftotext : ${PDFTOTEXT ?? "NOT FOUND — install poppler"}`);
console.log(`[groq] pdftoppm  : ${PDFTOPPM  ?? "NOT FOUND — install poppler"}`);

// ---------------------------------------------------------------------------
// Error handler
// Catches BOTH 429 (rate limit) and 413 (token-per-minute limit).
// Previously only 429 was caught, so a 413 fell through as a generic throw
// and showed as INTERNAL_ERROR (HTTP 500) in the API response.
// ---------------------------------------------------------------------------

function handleGroqError(err: unknown): never {
  if (err instanceof Error && "status" in err) {
    const status = (err as Error & { status: number }).status;

    if (status === 429 || status === 413) {
      // Prefer the retry-after header (Groq sets it accurately)
      const headers =
        "headers" in err &&
        typeof (err as Record<string, unknown>)["headers"] === "object"
          ? ((err as Record<string, unknown>)["headers"] as Record<string, string>)
          : {};

      const headerRetry = Number(headers["retry-after"]);
      const msgMatch = err.message.match(/retry[^0-9]*(\d+)s/i);
      const retrySeconds = !isNaN(headerRetry)
        ? headerRetry
        : msgMatch?.[1]
        ? parseInt(msgMatch[1], 10)
        : 60;

      const label = status === 413 ? "Token limit" : "Rate limit";
      throw new AppError(
        "LLM_QUOTA_EXCEEDED",
        `Groq ${label} exceeded. Retry after ${retrySeconds}s`,
        undefined,
        retrySeconds * 1000,
      );
    }
  }
  throw err;
}

// ---------------------------------------------------------------------------
// JSON cleanup helper
// ---------------------------------------------------------------------------

function cleanLLMResponse(raw: string): string {
  let text = raw
    .replace(/^```(?:json)?\s*/im, "")
    .replace(/\s*```\s*$/im, "")
    .trim();

  // Prefer outermost array (extraction endpoint returns arrays)
  const arrayStart = text.indexOf("[");
  const arrayEnd   = text.lastIndexOf("]");
  if (arrayStart !== -1 && arrayEnd > arrayStart) {
    return text.slice(arrayStart, arrayEnd + 1).trim();
  }

  // Fall back to outermost object (validation endpoint returns objects)
  const objStart = text.indexOf("{");
  const objEnd   = text.lastIndexOf("}");
  if (objStart !== -1 && objEnd > objStart) {
    return text.slice(objStart, objEnd + 1).trim();
  }

  return text;
}

// ---------------------------------------------------------------------------
// PDF → text
// Pipeline: pdftotext (text-layer PDFs) → pdftoppm + Tesseract (scanned PDFs)
// ---------------------------------------------------------------------------

async function convertPdfToText(buffer: Buffer): Promise<string> {
  const uid     = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const tempPdf = `/tmp/pdf_${uid}.pdf`;

  try {
    fs.writeFileSync(tempPdf, buffer);

    // ── Step 1: pdftotext for text-layer PDFs ─────────────────────────────
    if (PDFTOTEXT) {
      try {
        const text = execSync(`"${PDFTOTEXT}" "${tempPdf}" -`, {
          encoding: "utf-8",
          stdio: ["pipe", "pipe", "pipe"],
        }).trim();

        if (text.length > 50) {
          console.log(`[groq] pdftotext extracted ${text.length} chars`);
          return text;
        }
        console.log("[groq] pdftotext returned empty — PDF has no text layer");
      } catch (err: unknown) {
        console.warn(
          "[groq] pdftotext failed:",
          err instanceof Error ? err.message.split("\n")[0] : String(err),
        );
      }
    }

    // ── Step 2: pdftoppm → page images → Tesseract OCR ────────────────────
    if (!PDFTOPPM) {
      console.error("[groq] pdftoppm not found. Install: brew install poppler");
      return "[PDF — install poppler to enable OCR: brew install poppler]";
    }

    console.log("[groq] No text layer — rasterising pages for OCR...");
    const tempDir = `/tmp/pdf_pages_${uid}`;
    fs.mkdirSync(tempDir, { recursive: true });

    try {
      execSync(
        `"${PDFTOPPM}" -r 200 -l 5 -png "${tempPdf}" "${tempDir}/page"`,
        { stdio: ["pipe", "pipe", "pipe"] },
      );

      const pageFiles = fs
        .readdirSync(tempDir)
        .filter((f) => f.endsWith(".png") || f.endsWith(".ppm") || f.endsWith(".jpg"))
        .sort();

      if (pageFiles.length === 0) return "[PDF — no pages rasterised for OCR]";

      console.log(`[groq] OCR-ing ${pageFiles.length} page(s)...`);

      const ocrResults = await Promise.all(
        pageFiles.map(async (file) => {
          const imgBuffer = fs.readFileSync(`${tempDir}/${file}`);
          try {
            const result = await Tesseract.recognize(imgBuffer, "eng", {
              logger: () => {},
            });
            return result.data.text.trim();
          } catch (err: unknown) {
            console.warn(
              `[groq] Tesseract failed for ${file}:`,
              err instanceof Error ? err.message.split("\n")[0] : String(err),
            );
            return "";
          }
        }),
      );

      const combined = ocrResults.filter(Boolean).join("\n\n--- Page Break ---\n\n");
      if (combined.length > 0) {
        console.log(`[groq] OCR complete — ${combined.length} chars`);
        return combined;
      }
      return "[PDF — OCR found no readable text]";
    } catch (err: unknown) {
      console.error(
        "[groq] pdftoppm failed:",
        err instanceof Error ? err.message.split("\n")[0] : String(err),
      );
      return "[PDF — rasterisation failed, please re-upload a clearer scan]";
    } finally {
      try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
    }
  } finally {
    try { fs.unlinkSync(tempPdf); } catch {}
  }
}

// ---------------------------------------------------------------------------
// Image → text (OCR)
// ---------------------------------------------------------------------------

async function extractImageText(buffer: Buffer): Promise<string> {
  try {
    const result = await Tesseract.recognize(buffer, "eng", { logger: () => {} });
    return result.data.text.trim() || "[Image contains no readable text]";
  } catch (err: unknown) {
    console.warn(
      "[groq] Image OCR failed:",
      err instanceof Error ? err.message.split("\n")[0] : String(err),
    );
    return "[Image — OCR extraction failed]";
  }
}

// ---------------------------------------------------------------------------
// GroqProvider
// ---------------------------------------------------------------------------

export class GroqProvider implements LLMProvider {
  private readonly client: Groq;
  private readonly modelName: string;

  // Hard cap on chars sent per call.
  // llama-3.1-8b-instant free tier: 6 000 TPM ≈ ~24 000 chars.
  // 16 000 char cap leaves plenty of headroom for both extraction and validation
  // while ensuring the model has a large output token budget for its response.
  private readonly MAX_CHARS = 16_000;

  constructor(apiKey: string, modelName: string) {
    this.client = new Groq({ apiKey });
    this.modelName = modelName;
  }

  async extractDocument(
    parts: Array<{ buffer: Buffer; mimeType: string }>,
    prompt: string,
  ): Promise<string> {
    const documentContent = await Promise.all(
      parts.map(async ({ buffer, mimeType }) => {
        if (mimeType === "application/pdf") {
          return `PDF Content:\n${await convertPdfToText(buffer)}`;
        } else if (mimeType.startsWith("image/")) {
          return `Image Content (OCR):\n${await extractImageText(buffer)}`;
        } else {
          return buffer.toString("utf-8");
        }
      }),
    );

    let fullPrompt =
      `${prompt}\n\nDOCUMENT CONTENT TO ANALYZE:\n` +
      documentContent.join("\n\n---\n\n");

    if (fullPrompt.length > this.MAX_CHARS) {
      fullPrompt = fullPrompt.substring(0, this.MAX_CHARS) + "\n...[content truncated]";
    }

    console.log(`[groq] Sending ${fullPrompt.length} chars to LLM`);

    let result;
    try {
      result = await this.client.chat.completions.create({
        model: this.modelName,
        max_tokens: 4096,
        messages: [{ role: "user", content: fullPrompt }],
      });
    } catch (err) {
      handleGroqError(err);
    }

    const raw = result.choices[0]?.message?.content ?? "";
    return cleanLLMResponse(raw);
  }

  async generateText(prompt: string): Promise<string> {
    // Guard: truncate oversized prompts before they reach Groq and return a 413.
    // This is the last line of defence — toSlimSummary + compact prompt should
    // already keep validation prompts well under the limit.
    let safePrompt = prompt;
    if (safePrompt.length > this.MAX_CHARS) {
      console.warn(
        `[groq] generateText prompt too large (${safePrompt.length} chars) — truncating to ${this.MAX_CHARS}`,
      );
      safePrompt = safePrompt.substring(0, this.MAX_CHARS) + "\n...[truncated]";
    }

    let result;
    try {
      result = await this.client.chat.completions.create({
        model: this.modelName,
        max_tokens: 4096,
        messages: [{ role: "user", content: safePrompt }],
      });
    } catch (err) {
      handleGroqError(err);
    }

    const raw = result.choices[0]?.message?.content ?? "";
    return cleanLLMResponse(raw);
  }
}