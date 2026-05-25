import Anthropic from "@anthropic-ai/sdk";
import { AppError } from "../middleware/errorHandler.js";
function handleAnthropicError(err) {
    if (err instanceof Error &&
        "status" in err &&
        err.status === 429) {
        throw new AppError("LLM_QUOTA_EXCEEDED", `Anthropic API rate limited. Please retry after a moment.`, undefined, 60000);
    }
    throw err;
}
export class AnthropicProvider {
    client;
    modelName;
    constructor(apiKey, modelName) {
        this.client = new Anthropic({ apiKey });
        this.modelName = modelName;
    }
    async extractDocument(parts, prompt) {
        // Build the content array with proper media type handling
        const content = [];
        for (const { buffer, mimeType } of parts) {
            const base64Data = buffer.toString("base64");
            if (mimeType === "application/pdf") {
                // PDFs must use type: "document" for Claude
                content.push({
                    type: "document",
                    source: {
                        type: "base64",
                        media_type: "application/pdf",
                        data: base64Data,
                    },
                });
            }
            else if (mimeType.startsWith("image/")) {
                // Images use type: "image"
                content.push({
                    type: "image",
                    source: {
                        type: "base64",
                        media_type: mimeType,
                        data: base64Data,
                    },
                });
            }
        }
        // Add the text prompt
        content.push({
            type: "text",
            text: prompt,
        });
        let result;
        try {
            result = await this.client.messages.create({
                model: this.modelName,
                max_tokens: 4096,
                messages: [
                    {
                        role: "user",
                        content,
                    },
                ],
            });
        }
        catch (err) {
            handleAnthropicError(err);
        }
        const text = result.content[0]?.type === "text" ? result.content[0].text : "";
        return text
            .replace(/^```(?:json)?\s*/i, "")
            .replace(/\s*```$/, "")
            .trim();
    }
    async generateText(prompt) {
        let result;
        try {
            result = await this.client.messages.create({
                model: this.modelName,
                max_tokens: 4096,
                messages: [
                    {
                        role: "user",
                        content: prompt,
                    },
                ],
            });
        }
        catch (err) {
            handleAnthropicError(err);
        }
        const text = result.content[0]?.type === "text" ? result.content[0].text : "";
        return text
            .replace(/^```(?:json)?\s*/i, "")
            .replace(/\s*```$/, "")
            .trim();
    }
}
//# sourceMappingURL=anthropic.provider.js.map