import type { FastifyInstance } from "fastify";
import { getSessionDetail } from "../services/session.service.js";

export async function sessionsRoute(app: FastifyInstance) {
  app.get("/sessions/:sessionId", async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };

    const detail = await getSessionDetail(sessionId);

    return reply.status(200).send(detail);
  });
}
