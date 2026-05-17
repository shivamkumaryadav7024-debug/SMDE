import { config } from "../config.js";
import type { LLMProvider } from "./provider.interface.js";
import { GeminiProvider } from "./gemini.provider.js";

let _instance: LLMProvider | null = null;

/**
 * Returns a singleton LLMProvider based on the LLM_PROVIDER env var.
 * Adding a new provider: implement LLMProvider, add a case here.
 */
export function getLLMProvider(): LLMProvider {
  if (_instance) return _instance;

  switch (config.LLM_PROVIDER) {
    case "gemini":
      _instance = new GeminiProvider(config.LLM_API_KEY, config.LLM_MODEL);
      break;
    default: {
      // TypeScript exhaustiveness check — will error at compile time if a new
      // enum value is added to LLM_PROVIDER without handling it here.
      const _exhaustive: never = config.LLM_PROVIDER;
      throw new Error(`Unknown LLM_PROVIDER: ${_exhaustive}`);
    }
  }

  return _instance;
}
