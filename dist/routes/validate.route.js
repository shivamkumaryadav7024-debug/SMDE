import { runValidation } from "../services/validation.service.js";
import { config } from "../config.js";
export async function validateRoute(app) {
    app.post("/sessions/:sessionId/validate", {
        config: {
            rateLimit: {
                max: config.RATE_LIMIT_GENERAL_RPM,
                timeWindow: "1 minute",
            },
        },
    }, async (request, reply) => {
        const { sessionId } = request.params;
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
//# sourceMappingURL=validate.route.js.map