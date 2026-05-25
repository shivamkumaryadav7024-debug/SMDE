import { LLMProvider } from "./provider.interface.js";
import Anthropic from "@anthropic-ai/sdk";

/**
 * Anthropic Claude LLM Provider
 * 
 * Uses Claude (Haiku recommended for cost-effectiveness on extraction tasks).
 * Claude is the most reliable for structured JSON output.
 */
export class AnthropicProvider implements LLMProvider {
  private client: Anthropic;
  private model: string;

  constructor(apiKey: string, model: string) {
    this.client = new Anthropic({ apiKey });
    this.model = model || "claude-haiku-4-5-20251001";
  }

  /**
   * Extract structured data from documents using Claude's vision capabilities.
   */
  async extractDocument(
    parts: Array<{ buffer: Buffer; mimeType: string }>,
    prompt: string,
  ): Promise<string> {
    // Build content array
    const content: Array<
      | { type: "text"; text: string }
      | { type: "image"; source: { type: "base64"; media_type: string; data: string } }
    > = [];

    // Add images
    for (const part of parts) {
      if (part.mimeType.startsWith("image/")) {
        const base64 = part.buffer.toString("base64");
        content.push({
          type: "image",
          source: {
            type: "base64",
            media_type: part.mimeType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
            data: base64,
          },
        });
      } else if (part.mimeType === "application/pdf") {
        // Claude natively supports base64 PDFs
        const base64 = part.buffer.toString("base64");
        content.push({
          type: "image",
          source: {
            type: "base64",
            media_type: "application/pdf",
            data: base64,
          } as any,
        });
      }
    }

    // Add text prompt
    content.push({ type: "text", text: prompt });

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 4096,
      messages: [
        {
          role: "user",
          content: content as any,
        },
      ],
    });

    // Extract text from response
    if (response.content[0].type === "text") {
      return response.content[0].text;
    }

    throw new Error("Unexpected response format from Anthropic");
  }

  /**
   * Generate text-only responses (no images) for validation tasks.
   */
  async generateText(prompt: string): Promise<string> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 4096,
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
    });

    if (response.content[0].type === "text") {
      return response.content[0].text;
    }

    throw new Error("Unexpected response format from Anthropic");
  }
}
