import { LLMProvider } from "./provider.interface.js";
import Groq from "groq-sdk";

/**
 * Groq LLM Provider
 * 
 * Uses Groq's LLaMA 3.2 vision model for fast, accurate extraction.
 * Groq provides the lowest latency and is excellent for structured tasks.
 */
export class GroqProvider implements LLMProvider {
  private client: Groq;
  private model: string;

  constructor(apiKey: string, model: string) {
    this.client = new Groq({ apiKey });
    this.model = model || "llama-3.2-11b-vision-preview";
  }

  /**
   * Extract structured data from documents using Groq's vision model.
   */
  async extractDocument(
    parts: Array<{ buffer: Buffer; mimeType: string }>,
    prompt: string,
  ): Promise<string> {
    // Convert buffer parts to base64
    const content: Array<{
      type: string;
      text?: string;
      image_url?: { url: string };
    }> = [];

    // Add text prompt
    content.push({ type: "text", text: prompt });

    // Add images (Groq supports image inputs)
    for (const part of parts) {
      if (part.mimeType.startsWith("image/")) {
        const base64 = part.buffer.toString("base64");
        content.push({
          type: "image_url",
          image_url: { url: `data:${part.mimeType};base64,${base64}` },
        });
      }
    }

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

    throw new Error("Unexpected response format from Groq");
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

    throw new Error("Unexpected response format from Groq");
  }
}
