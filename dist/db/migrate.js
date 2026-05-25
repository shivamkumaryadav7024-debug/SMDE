import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { config } from "../config.js";
import { fileURLToPath } from "url";
import path from "path";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
async function runMigrations() {
    const pool = new pg.Pool({ connectionString: config.DATABASE_URL });
    const db = drizzle(pool);
    console.log("[migrate] Running database migrations...");
    await migrate(db, {
        migrationsFolder: path.join(__dirname, "migrations"),
    });
    console.log("[migrate] Migrations complete.");
    await pool.end();
}
runMigrations().catch((err) => {
    console.error("[migrate] Migration failed:", err);
    process.exit(1);
});
//# sourceMappingURL=migrate.js.map