import Fastify from "fastify";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import { config, MAX_FILE_SIZE_BYTES } from "./config.js";
import { healthRoute } from "./routes/health.route.js";
import { extractRoute } from "./routes/extract.route.js";
import { jobsRoute } from "./routes/jobs.route.js";
import { sessionsRoute } from "./routes/sessions.route.js";
import { validateRoute } from "./routes/validate.route.js";
import { reportRoute } from "./routes/report.route.js";
import { pingLlmRoute } from "./routes/ping-llm.route.js";
import { errorHandler } from "./middleware/errorHandler.js";
export async function buildApp() {
    const app = Fastify({
        logger: {
            level: config.NODE_ENV === "production" ? "info" : "debug",
            transport: config.NODE_ENV !== "production"
                ? { target: "pino-pretty", options: { colorize: true } }
                : undefined,
        },
    });
    // ── Multipart (file uploads) ───────────────────────────────────────────────
    await app.register(multipart, {
        limits: {
            fileSize: MAX_FILE_SIZE_BYTES,
            files: 1,
        },
    });
    // ── Rate limiting ──────────────────────────────────────────────────────────
    await app.register(rateLimit, {
        global: false, // applied per-route
    });
    // ── Global error handler ───────────────────────────────────────────────────
    app.setErrorHandler(errorHandler);
    // ── Routes ────────────────────────────────────────────────────────────────
    await app.register(healthRoute, { prefix: "/api" });
    await app.register(extractRoute, { prefix: "/api" });
    await app.register(jobsRoute, { prefix: "/api" });
    await app.register(sessionsRoute, { prefix: "/api" });
    await app.register(validateRoute, { prefix: "/api" });
    await app.register(reportRoute, { prefix: "/api" });
    await app.register(pingLlmRoute, { prefix: "/api" });
    return app;
}
//# sourceMappingURL=app.js.map