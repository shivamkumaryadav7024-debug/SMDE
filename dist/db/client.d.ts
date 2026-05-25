import * as schema from "./schema.js";
declare const pool: import("pg").Pool;
export declare const db: import("drizzle-orm/node-postgres").NodePgDatabase<typeof schema> & {
    $client: import("pg").Pool;
};
/**
 * Ping the database. Returns true if reachable, false otherwise.
 * Used by the health check endpoint.
 */
export declare function pingDatabase(): Promise<boolean>;
export { pool };
//# sourceMappingURL=client.d.ts.map