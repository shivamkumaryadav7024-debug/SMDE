import Groq from "groq-sdk";
import { AppError } from "../middleware/errorHandler.js";
import * as fs from "fs";
import { execSync } from "child_process";
import Tesseract from "tesseract.js";
function handleGroqError(err) {
    if (err instanceof Error &&
        "status" in err &&
        err.status === 429) {
        // Try to extract retryDelay from the error message
        const match = err.message.match(/retry[^0-9]*(\d+)s/i);
        const retrySeconds = match?.[1] ? parseInt(match[1], 10) : 60;
        throw new AppError("LLM_QUOTA_EXCEEDED", `Groq API rate limit exceeded. Retry after ${retrySeconds}s`, undefined, retrySeconds * 1000);
    }
    throw err;
}
/**
 * Converts PDF to text using pdftotext utility
 * Falls back to extraction summary if conversion fails
 */
async function convertPdfToText(buffer) {
    try {
        const tempFile = `/tmp/temp_${Date.now()}.pdf`;
        fs.writeFileSync(tempFile, buffer);
        try {
            const text = execSync(`pdftotext "${tempFile}" -`, {
                encoding: "utf-8",
                stdio: ["pipe", "pipe", "ignore"],
            });
            fs.unlinkSync(tempFile);
            return text.trim();
        }
        catch {
            fs.unlinkSync(tempFile);
            return "[PDF Document - Text extraction unavailable, please verify document format]";
        }
    }
    catch {
        return "[PDF Document - Unable to process]";
    }
}
/**
 * Extracts text from images using Tesseract OCR
 */
async function extractImageText(buffer) {
    try {
        // Save buffer to temp file for tesseract
        const tempFile = `/tmp/ocr_${Date.now()}.jpg`;
        fs.writeFileSync(tempFile, buffer);
        try {
            const result = await Tesseract.recognize(buffer, "eng", {
                logger: () => { }, // Suppress progress logs
            });
            fs.unlinkSync(tempFile);
            const text = result.data.text.trim();
            return text || "[Image contains no readable text]";
        }
        catch {
            fs.unlinkSync(tempFile);
            return "[Image - OCR extraction failed]";
        }
    }
    catch {
        return "[Image - Unable to process]";
    }
}
export class GroqProvider {
    client;
    modelName;
    constructor(apiKey, modelName) {
        this.client = new Groq({ apiKey });
        this.modelName = modelName;
    }
    async extractDocument(parts, prompt) {
        // Process files: convert PDFs to text, extract OCR from images, etc.
        const documentContent = await Promise.all(parts.map(async ({ buffer, mimeType }) => {
            if (mimeType === "application/pdf") {
                const text = await convertPdfToText(buffer);
                return `PDF Content:\n${text}`;
            }
            else if (mimeType.startsWith("image/")) {
                const text = await extractImageText(buffer);
                return `Image Content (OCR):\n${text}`;
            }
            else if (mimeType === "text/plain") {
                return buffer.toString("utf-8");
            }
            else {
                try {
                    return buffer.toString("utf-8");
                }
                catch {
                    return "[Document - Unable to extract content]";
                }
            }
        }));
        // Limit prompt length to avoid context overflow
        const maxContentLength = 8000;
        let fullPrompt = `${documentContent.join("\n\n---\n\n")}\n\nExtraction Task: ${prompt}`;
        if (fullPrompt.length > maxContentLength) {
            fullPrompt = fullPrompt.substring(0, maxContentLength) + "...[content truncated]";
        }
        let result;
        try {
            result = await this.client.chat.completions.create({
                model: this.modelName,
                max_tokens: 2048,
                messages: [
                    {
                        role: "user",
                        content: fullPrompt,
                    },
                ],
            });
        }
        catch (err) {
            handleGroqError(err);
        }
        const text = result.choices[0]?.message?.content ?? "";
        return text
            .replace(/^```(?:json)?\s*/i, "")
            .replace(/\s*```$/, "")
            .trim();
    }
    async generateText(prompt) {
        let result;
        try {
            result = await this.client.chat.completions.create({
                model: this.modelName,
                max_tokens: 2048,
                messages: [
                    {
                        role: "user",
                        content: prompt,
                    },
                ],
            });
        }
        catch (err) {
            handleGroqError(err);
        }
        const text = result.choices[0]?.message?.content ?? "";
        return text
            .replace(/^```(?:json)?\s*/i, "")
            .replace(/\s*```$/, "")
            .trim();
    }
}
//# sourceMappingURL=groq.provider.js.map