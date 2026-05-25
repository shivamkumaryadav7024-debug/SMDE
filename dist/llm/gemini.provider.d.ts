import type { LLMProvider } from "./provider.interface.js";
export declare class GeminiProvider implements LLMProvider {
    private readonly ai;
    private readonly modelName;
    constructor(apiKey: string, modelName: string);
    extractDocument(parts: Array<{
        buffer: Buffer;
        mimeType: string;
    }>, prompt: string): Promise<string>;
    generateText(prompt: string): Promise<string>;
}
//# sourceMappingURL=gemini.provider.d.ts.map