import PDF2Pic from "pdf2pic";
import { join } from "path";
import { mkdirSync, unlinkSync } from "fs";
import { randomUUID } from "crypto";
const TEMP_DIR = "/tmp/maritime-pdf-conversion";
// Ensure temp directory exists
mkdirSync(TEMP_DIR, { recursive: true });
/**
 * Convert a PDF buffer to PNG image buffer.
 * Used when sending PDFs to LLM providers that handle images better than PDFs.
 * Returns first page only.
 */
export async function convertPdfToImage(pdfBuffer, fileName) {
    const tempId = randomUUID();
    const tempPdfPath = join(TEMP_DIR, `${tempId}.pdf`);
    const tempOutputDir = join(TEMP_DIR, `${tempId}-out`);
    try {
        // Write PDF buffer to temp file
        const { writeFileSync } = await import("fs");
        writeFileSync(tempPdfPath, pdfBuffer);
        // Convert first page to PNG
        const converter = new PDF2Pic({
            density: 300, // DPI for quality
            savedir: tempOutputDir,
            format: "png",
            width: 2000,
            height: 2800,
            preserveAspectRatio: true,
            quality: 100,
        });
        const result = await converter.bulk([tempPdfPath], {
            outputFormat: "png",
        });
        if (!result || result.length === 0) {
            throw new Error("PDF conversion produced no output");
        }
        // Read the converted image
        const { readFileSync } = await import("fs");
        const imagePath = result[0].page_1;
        if (!imagePath) {
            throw new Error("No first page image generated");
        }
        const imageBuffer = readFileSync(imagePath);
        // Cleanup temp files
        try {
            unlinkSync(tempPdfPath);
            const { rmSync } = await import("fs");
            rmSync(tempOutputDir, { recursive: true, force: true });
        }
        catch {
            // Ignore cleanup errors
        }
        return imageBuffer;
    }
    catch (err) {
        // Cleanup on error
        try {
            unlinkSync(tempPdfPath);
            const { rmSync } = await import("fs");
            rmSync(tempOutputDir, { recursive: true, force: true });
        }
        catch {
            // Ignore cleanup errors
        }
        throw new Error(`PDF conversion failed: ${err instanceof Error ? err.message : String(err)}`);
    }
}
/**
 * Determine if a buffer should be converted to image before sending to LLM.
 * Returns true for PDFs, false for images that are already suitable.
 */
export function shouldConvertToImage(mimeType) {
    return mimeType === "application/pdf";
}
//# sourceMappingURL=pdfConverter.js.map