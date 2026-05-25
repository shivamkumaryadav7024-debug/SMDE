export interface LLMProvider {
    /**
     * Send one or more file buffers to the LLM with a prompt.
     * Each entry carries its own mimeType so PDFs can be sent directly
     * without conversion — Gemini natively supports application/pdf.
     *
     * For other providers that need images, implement PDF→image conversion
     * inside the provider itself, keeping business logic provider-agnostic.
     */
    extractDocument(parts: Array<{
        buffer: Buffer;
        mimeType: string;
    }>, prompt: string): Promise<string>;
    /**
     * Send a text-only prompt and return the raw response.
     * Used for cross-document validation where no file is needed.
     */
    generateText(prompt: string): Promise<string>;
}
//# sourceMappingURL=provider.interface.d.ts.map