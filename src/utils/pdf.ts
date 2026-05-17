import { fromBuffer } from "pdf2pic";
import path from "path";
import os from "os";
import { randomUUID } from "crypto";

/**
 * Convert a PDF buffer into one PNG Buffer per page.
 *
 * pdf2pic writes temp files to disk and returns their paths; we read them
 * back as Buffers and return them so the caller never touches the filesystem.
 */
export async function pdfToImages(pdfBuffer: Buffer): Promise<Buffer[]> {
  const tmpDir = path.join(os.tmpdir(), `maritime-pdf-${randomUUID()}`);

  const converter = fromBuffer(pdfBuffer, {
    density: 150, // DPI — high enough for text recognition
    format: "png",
    width: 1700,
    height: 2200,
    saveFilename: "page",
    savePath: tmpDir,
  });

  // Convert all pages (-1 = all)
  const results = await converter.bulk(-1, { responseType: "buffer" });

  const buffers: Buffer[] = [];

  for (const result of results) {
    if (result.buffer) {
      buffers.push(result.buffer);
    }
  }

  if (buffers.length === 0) {
    throw new Error("PDF conversion produced no pages");
  }

  return buffers;
}
