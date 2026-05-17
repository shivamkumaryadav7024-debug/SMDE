import { buildApp } from "./app.js";
import { config } from "./config.js";
import { pingDatabase } from "./db/client.js";

const startTime = Date.now();

async function start() {
  const app = await buildApp();

  // Verify DB connectivity before accepting traffic
  const dbOk = await pingDatabase();
  if (!dbOk) {
    app.log.error(
      "[startup] Cannot reach database. Check DATABASE_URL and that PostgreSQL is running.",
    );
    process.exit(1);
  }

  app.log.info("[startup] Database connection OK");

  await app.listen({ port: config.PORT, host: "0.0.0.0" });
  app.log.info(
    `[startup] Server ready on port ${config.PORT} (${config.NODE_ENV})`,
  );
  app.log.info(`[startup] Boot time: ${Date.now() - startTime}ms`);
}

process.on("unhandledRejection", (err) => {
  console.error("[process] Unhandled rejection:", err);
  process.exit(1);
});

start();
