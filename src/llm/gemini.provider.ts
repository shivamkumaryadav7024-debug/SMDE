import {
  GoogleGenerativeAI,
  type GenerateContentRequest,
  type Part,
} from "@google/generative-ai";
import type { LLMProvider } from "./provider.interface.js";

export class GeminiProvider implements LLMProvider {
  private readonly client: GoogleGenerativeAI;
  private readonly modelName: string;

  constructor(apiKey: string, modelName: string) {
    this.client = new GoogleGenerativeAI(apiKey);
    this.modelName = modelName;
  }

  async extractDocument(
    parts: Array<{ buffer: Buffer; mimeType: string }>,
    prompt: string,
  ): Promise<string> {
    const model = this.client.getGenerativeModel({ model: this.modelName });

    // Build inline image parts — one per page/buffer (always PNG after pdf2pic conversion)
    const imageParts: Part[] = parts.map(({ buffer }) => ({
      inlineData: {
        mimeType: "image/png",
        data: buffer.toString("base64"),
      },
    }));

    const request: GenerateContentRequest = {
      contents: [
        {
          role: "user",
          parts: [...imageParts, { text: prompt }],
        },
      ],
      generationConfig: {
        // Deterministic output for structured extraction
        temperature: 0,
        topP: 1,
        topK: 1,
      },
    };

    const result = await model.generateContent(request);
    const response = result.response;
    const text = response.text();

    // Strip markdown code fences if the model wraps the JSON (defensive)
    return text
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "")
      .trim();
  }

  async generateText(prompt: string): Promise<string> {
    const model = this.client.getGenerativeModel({ model: this.modelName });

    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0, topP: 1, topK: 1 },
    });

    const text = result.response.text();
    return text
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "")
      .trim();
  }
}
