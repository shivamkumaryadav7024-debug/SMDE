import { getSessionDetail } from "../services/session.service.js";
import { config } from "../config.js";
export async function sessionsRoute(app) {
    app.get("/sessions/:sessionId", {
        config: {
            rateLimit: {
                max: config.RATE_LIMIT_GENERAL_RPM,
                timeWindow: "1 minute",
            },
        },
    }, async (request, reply) => {
        const { sessionId } = request.params;
        const detail = await getSessionDetail(sessionId);
        return reply.status(200).send(detail);
    });
}
//# sourceMappingURL=sessions.route.js.map