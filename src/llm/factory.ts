import { config } from "../config.js";
import type { LLMProvider } from "./provider.interface.js";
import { GeminiProvider } from "./gemini.provider.js";

let _instance: LLMProvider | null = null;

/**
 * Returns a singleton LLMProvider based on the LLM_PROVIDER env var.
 * Adding a new provider: implement LLMProvider, add a case here.
 */
export async function getLLMProvider(): Promise<LLMProvider> {
  if (_instance) return _instance;

  switch (config.LLM_PROVIDER) {
    case "gemini":
      _instance = new GeminiProvider(
        config.LLM_API_KEY,
        config.LLM_MODEL
      );
      break;

    case "anthropic": {
      const { AnthropicProvider } = await import(
        "./anthropic.provider.js"
      );

      _instance = new AnthropicProvider(
        config.LLM_API_KEY,
        config.LLM_MODEL
      );

      break;
    }

    case "groq": {
      const { GroqProvider } = await import(
        "./groq.provider.js"
      );

      _instance = new GroqProvider(
        config.LLM_API_KEY,
        config.LLM_MODEL
      );

      break;
    }

    default: {
      const _exhaustive: never = config.LLM_PROVIDER;

      throw new Error(
        `Unknown LLM_PROVIDER: ${_exhaustive}`
      );
    }
  }

  return _instance;
}