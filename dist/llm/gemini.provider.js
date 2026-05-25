import { GoogleGenAI, createPartFromUri, createUserContent, } from "@google/genai";
import { AppError } from "../middleware/errorHandler.js";
function handleGeminiError(err) {
    if (err instanceof Error &&
        "status" in err &&
        err.status === 429) {
        // Try to extract retryDelay from the error message (e.g. "Please retry in 53s")
        const match = err.message.match(/retry[^0-9]*(\d+)s/i);
        const retrySeconds = match?.[1] ? parseInt(match[1], 10) : 60;
        throw new AppError("LLM_QUOTA_EXCEEDED", `Gemini API quota exceeded. Retry after ${retrySeconds}s or enable billing at https://ai.google.dev/gemini-api/docs/rate-limits`, undefined, retrySeconds * 1000);
    }
    throw err;
}
export class GeminiProvider {
    ai;
    modelName;
    constructor(apiKey, modelName) {
        this.ai = new GoogleGenAI({ apiKey });
        this.modelName = modelName;
    }
    async extractDocument(parts, prompt) {
        // Upload each file as a Blob — no base64 in the generation request,
        // no temp files on disk. Google hosts the file and we reference it by URI.
        const fileParts = await Promise.all(parts.map(async ({ buffer, mimeType }) => {
            const blob = new Blob([new Uint8Array(buffer)], { type: mimeType });
            let uploaded = await this.ai.files.upload({
                file: blob,
                config: { mimeType },
            });
            // Wait for Google to finish processing (mainly relevant for PDFs)
            while (uploaded.state === "PROCESSING") {
                await new Promise((r) => setTimeout(r, 1500));
                uploaded = await this.ai.files.get({ name: uploaded.name });
            }
            if (uploaded.state === "FAILED") {
                throw new AppError("LLM_FILE_UPLOAD_FAILED", "File processing failed on Gemini servers.");
            }
            return createPartFromUri(uploaded.uri, uploaded.mimeType);
        }));
        let result;
        try {
            result = await this.ai.models.generateContent({
                model: this.modelName,
                contents: createUserContent([...fileParts, "\n\n", prompt]),
                config: { temperature: 0, topP: 1, topK: 1 },
            });
        }
        catch (err) {
            handleGeminiError(err);
        }
        const text = result.text ?? "";
        return text
            .replace(/^```(?:json)?\s*/i, "")
            .replace(/\s*```$/, "")
            .trim();
    }
    async generateText(prompt) {
        let result;
        try {
            result = await this.ai.models.generateContent({
                model: this.modelName,
                contents: createUserContent(prompt),
                config: { temperature: 0, topP: 1, topK: 1 },
            });
        }
        catch (err) {
            handleGeminiError(err);
        }
        const text = result.text ?? "";
        return text
            .replace(/^```(?:json)?\s*/i, "")
            .replace(/\s*```$/, "")
            .trim();
    }
}
//# sourceMappingURL=gemini.provider.js.map