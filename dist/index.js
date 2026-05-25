import { buildApp } from "./app.js";
import { config } from "./config.js";
import { pingDatabase } from "./db/client.js";
import { initBoss } from "./queue/boss.js";
import { startWorker } from "./queue/worker.js";
import { mkdir } from "fs/promises";
const startTime = Date.now();
async function start() {
    const app = await buildApp();
    // Verify DB connectivity before accepting traffic
    const dbOk = await pingDatabase();
    if (!dbOk) {
        app.log.error("[startup] Cannot reach database. Check DATABASE_URL and that PostgreSQL is running.");
        process.exit(1);
    }
    app.log.info("[startup] Database connection OK");
    // Ensure temp upload directory exists
    await mkdir(config.TEMP_UPLOAD_DIR, { recursive: true });
    app.log.info(`[startup] Temp upload dir: ${config.TEMP_UPLOAD_DIR}`);
    // Start queue and worker
    try {
        const boss = await initBoss();
        console.log("[startup] pg-boss initialized successfully");
        await startWorker();
        app.log.info("[startup] Queue worker started");
    }
    catch (err) {
        console.error("[startup] Failed to start queue worker:", err);
        process.exit(1);
    }
    await app.listen({ port: config.PORT, host: "0.0.0.0" });
    app.log.info(`[startup] Server ready on port ${config.PORT} (${config.NODE_ENV})`);
    app.log.info(`[startup] Boot time: ${Date.now() - startTime}ms`);
}
process.on("unhandledRejection", (err) => {
    console.error("[process] Unhandled rejection:", err);
    process.exit(1);
});
async function shutdown(signal) {
    console.log(`[process] Received ${signal}, shutting down gracefully...`);
    try {
        const { getBoss } = await import("./queue/boss.js");
        await getBoss().stop({ graceful: true });
        console.log("[process] pg-boss stopped");
    }
    catch {
        // Boss may not have started yet
    }
    process.exit(0);
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
start();
//# sourceMappingURL=index.js.map