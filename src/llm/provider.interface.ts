export interface LLMProvider {
  /**
   * Send one or more image buffers to the LLM with a prompt (vision call).
   * Used for document extraction — images are sent inline as base64.
   */
  extractDocument(
    parts: Array<{ buffer: Buffer; mimeType: string }>,
    prompt: string,
  ): Promise<string>;

  /**
   * Send a text-only prompt to the LLM and return the raw response.
   * Used for cross-document validation where no image is needed.
   */
  generateText(prompt: string): Promise<string>;
}
