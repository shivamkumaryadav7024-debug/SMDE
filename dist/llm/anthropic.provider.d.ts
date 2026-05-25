import type { LLMProvider } from "./provider.interface.js";
export declare class AnthropicProvider implements LLMProvider {
    private readonly client;
    private readonly modelName;
    constructor(apiKey: string, modelName: string);
    extractDocument(parts: Array<{
        buffer: Buffer;
        mimeType: string;
    }>, prompt: string): Promise<string>;
    generateText(prompt: string): Promise<string>;
}
//# sourceMappingURL=anthropic.provider.d.ts.map