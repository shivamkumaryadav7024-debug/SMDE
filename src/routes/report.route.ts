import type { FastifyInstance } from "fastify";
import { buildReport } from "../services/report.service.js";

export async function reportRoute(app: FastifyInstance) {
  app.get("/sessions/:sessionId/report", async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };

    const report = await buildReport(sessionId);

    return reply.status(200).send(report);
  });
}
