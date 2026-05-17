import type { FastifyInstance } from "fastify";
import { pingDatabase } from "../db/client.js";

const VERSION = "1.0.0";
const startTime = Date.now();

export async function healthRoute(app: FastifyInstance) {
  app.get("/health", async (_request, reply) => {
    const dbOk = await pingDatabase();

    const dependencies = {
      database: dbOk ? "OK" : "ERROR",
      // Queue and LLM provider will be populated in later phases
      queue: "OK",
      llmProvider: "OK",
    };

    const allOk = Object.values(dependencies).every((v) => v === "OK");

    return reply.status(allOk ? 200 : 503).send({
      status: allOk ? "OK" : "DEGRADED",
      version: VERSION,
      uptimeSeconds: Math.floor((Date.now() - startTime) / 1000),
      dependencies,
      timestamp: new Date().toISOString(),
    });
  });
}
