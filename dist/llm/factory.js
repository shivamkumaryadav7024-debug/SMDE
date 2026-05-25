import { config } from "../config.js";
import { GeminiProvider } from "./gemini.provider.js";
import { GroqProvider } from "./groq.provider.js";
import { AnthropicProvider } from "./anthropic.provider.js";
let _instance = null;
/**
 * Returns a singleton LLMProvider based on the LLM_PROVIDER env var.
 * Adding a new provider: implement LLMProvider, add a case here.
 */
export function getLLMProvider() {
    if (_instance)
        return _instance;
    switch (config.LLM_PROVIDER) {
        case "gemini":
            _instance = new GeminiProvider(config.LLM_API_KEY, config.LLM_MODEL);
            break;
        case "groq":
            _instance = new GroqProvider(config.LLM_API_KEY, config.LLM_MODEL);
            break;
        case "anthropic":
            _instance = new AnthropicProvider(config.LLM_API_KEY, config.LLM_MODEL);
            break;
        default: {
            // TypeScript exhaustiveness check — will error at compile time if a new
            // enum value is added to LLM_PROVIDER without handling it here.
            const _exhaustive = config.LLM_PROVIDER;
            throw new Error(`Unknown LLM_PROVIDER: ${_exhaustive}`);
        }
    }
    return _instance;
}
//# sourceMappingURL=factory.js.map