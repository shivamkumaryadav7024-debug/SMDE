import type { FastifyInstance } from "fastify";
import { runValidation } from "../services/validation.service.js";

export async function validateRoute(app: FastifyInstance) {
  app.post("/sessions/:sessionId/validate", async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };

    const result = await runValidation(sessionId);

    return reply.status(200).send({
      sessionId,
      holderProfile: result.holderProfile,
      consistencyChecks: result.consistencyChecks,
      missingDocuments: result.missingDocuments,
      expiringDocuments: result.expiringDocuments,
      medicalFlags: result.medicalFlags,
      overallStatus: result.overallStatus,
      overallScore: result.overallScore,
      summary: result.summary,
      recommendations: result.recommendations,
      validatedAt: result.validatedAt,
    });
  });
}
