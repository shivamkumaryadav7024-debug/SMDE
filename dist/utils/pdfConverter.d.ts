/**
 * Convert a PDF buffer to PNG image buffer.
 * Used when sending PDFs to LLM providers that handle images better than PDFs.
 * Returns first page only.
 */
export declare function convertPdfToImage(pdfBuffer: Buffer, fileName: string): Promise<Buffer>;
/**
 * Determine if a buffer should be converted to image before sending to LLM.
 * Returns true for PDFs, false for images that are already suitable.
 */
export declare function shouldConvertToImage(mimeType: string): boolean;
//# sourceMappingURL=pdfConverter.d.ts.map