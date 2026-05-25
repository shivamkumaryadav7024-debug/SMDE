import { z } from "zod";
import { config as loadDotenv } from "dotenv";

loadDotenv();

const configSchema = z.object({
  // Server
  PORT: z.coerce.number().int().positive().default(3000),
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),

  // Database
  DATABASE_URL: z
    .string()
    .url("DATABASE_URL must be a valid PostgreSQL connection URL"),

  // LLM — all three required at startup so the service fails fast rather than at first request
  LLM_PROVIDER: z.enum(["gemini", "groq", "anthropic"]).default("gemini"),
  LLM_MODEL: z.string().min(1, "LLM_MODEL is required"),
  LLM_API_KEY: z.string().min(1, "LLM_API_KEY is required"),

  // File handling
  MAX_FILE_SIZE_MB: z.coerce.number().positive().default(10),
  TEMP_UPLOAD_DIR: z.string().default("/tmp/maritime-uploads"),

  // Queue
  JOB_CONCURRENCY: z.coerce.number().int().positive().default(3),

  // Rate limiting
  RATE_LIMIT_EXTRACT_RPM: z.coerce.number().int().positive().default(20),
  RATE_LIMIT_GENERAL_RPM: z.coerce.number().int().positive().default(60),
});

const parsed = configSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  • ${i.path.join(".")}: ${i.message}`)
    .join("\n");
  console.error(
    `\n[config] Missing or invalid environment variables:\n${issues}\n`,
  );
  process.exit(1);
}

export const config = parsed.data;

// Derived constants
export const MAX_FILE_SIZE_BYTES = config.MAX_FILE_SIZE_MB * 1024 * 1024;
