import { pingDatabase } from "../db/client.js";
import { pingQueue } from "../queue/boss.js";
const VERSION = "1.0.0";
const startTime = Date.now();
export async function healthRoute(app) {
    app.get("/health", { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } }, async (_request, reply) => {
        const [dbOk, queueOk] = await Promise.all([pingDatabase(), pingQueue()]);
        const dependencies = {
            database: dbOk ? "OK" : "ERROR",
            queue: queueOk ? "OK" : "ERROR",
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
//# sourceMappingURL=health.route.js.map