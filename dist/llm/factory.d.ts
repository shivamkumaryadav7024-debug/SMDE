import type { LLMProvider } from "./provider.interface.js";
/**
 * Returns a singleton LLMProvider based on the LLM_PROVIDER env var.
 * Adding a new provider: implement LLMProvider, add a case here.
 */
export declare function getLLMProvider(): LLMProvider;
//# sourceMappingURL=factory.d.ts.map