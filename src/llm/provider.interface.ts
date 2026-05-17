export interface LLMProvider {
  /**
   * Send one or more file buffers (images or PDFs converted to images) to the
   * LLM along with a prompt and return the raw text response.
   *
   * @param buffers  - One buffer per page/image (PNG or JPEG)
   * @param mimeType - MIME type of the original file before any conversion
   * @param prompt   - The instruction prompt to accompany the document
   * @returns Raw text response from the model (expected to be JSON)
   */
  extractDocument(
    buffers: Buffer[],
    mimeType: string,
    prompt: string,
  ): Promise<string>;
}
