import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { config } from "../config.js";
import * as schema from "./schema.js";
const pool = new pg.Pool({
    connectionString: config.DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
});
pool.on("error", (err) => {
    console.error("[db] Unexpected pool error:", err);
});
export const db = drizzle(pool, { schema });
/**
 * Ping the database. Returns true if reachable, false otherwise.
 * Used by the health check endpoint.
 */
export async function pingDatabase() {
    try {
        await pool.query("SELECT 1");
        return true;
    }
    catch {
        return false;
    }
}
export { pool };
//# sourceMappingURL=client.js.map