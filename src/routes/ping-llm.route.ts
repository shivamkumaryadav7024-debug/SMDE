import type { FastifyInstance } from "fastify";
import { getLLMProvider } from "../llm/factory.js";
import { config } from "../config.js";

/**
 * Ping the LLM provider to verify connectivity and credentials.
 * Returns latency, model info, and provider status.
 * Useful for debugging LLM configuration issues.
 */
export async function pingLlmRoute(app: FastifyInstance) {
  app.get("/ping-llm", async (_request, reply) => {
    const startTime = Date.now();

    try {
      const provider = getLLMProvider();

      // Send a simple text prompt to verify the connection
      const testPrompt = "Respond with exactly: OK";
      const result = await provider.generateText(testPrompt);

      const latencyMs = Date.now() - startTime;

      return reply.status(200).send({
        status: "OK",
        provider: config.LLM_PROVIDER,
        model: config.LLM_MODEL,
        latencyMs,
        timestamp: new Date().toISOString(),
        message: result.substring(0, 100), // Echo first 100 chars of response
      });
    } catch (error) {
      const latencyMs = Date.now() - startTime;
      const message = error instanceof Error ? error.message : String(error);

      return reply.status(503).send({
        status: "ERROR",
        provider: config.LLM_PROVIDER,
        model: config.LLM_MODEL,
        latencyMs,
        timestamp: new Date().toISOString(),
        error: message,
      });
    }
  });
}
