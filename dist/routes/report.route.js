import { buildReport } from "../services/report.service.js";
import { config } from "../config.js";
export async function reportRoute(app) {
    app.get("/sessions/:sessionId/report", {
        config: {
            rateLimit: {
                max: config.RATE_LIMIT_GENERAL_RPM,
                timeWindow: "1 minute",
            },
        },
    }, async (request, reply) => {
        const { sessionId } = request.params;
        const report = await buildReport(sessionId);
        return reply.status(200).send(report);
    });
}
//# sourceMappingURL=report.route.js.map