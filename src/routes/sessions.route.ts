import type { FastifyInstance } from "fastify";
import { getSessionDetail } from "../services/session.service.js";
import { config } from "../config.js";

export async function sessionsRoute(app: FastifyInstance) {
  app.get(
    "/sessions/:sessionId",
    {
      config: {
        rateLimit: {
          max: config.RATE_LIMIT_GENERAL_RPM,
          timeWindow: "1 minute",
        },
      },
    },
    async (request, reply) => {
      const { sessionId } = request.params as { sessionId: string };

      const detail = await getSessionDetail(sessionId);

      return reply.status(200).send(detail);
    },
  );
}
