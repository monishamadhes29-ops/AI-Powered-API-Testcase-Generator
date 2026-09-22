import "dotenv/config";
import { z } from "zod";

const EnvironmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  CORS_ORIGIN: z.string().default("http://localhost:5173"),
  MAX_FILE_SIZE_MB: z.coerce.number().positive().default(5),
  SESSION_TTL_MINUTES: z.coerce.number().int().positive().default(60),
  // Timeout for fetching a Swagger/OpenAPI document from a user-supplied URL.
  URL_FETCH_TIMEOUT_MS: z.coerce.number().int().positive().default(15000),
  GROQ_API_KEY: z.string().trim().optional(),
  GROQ_MODEL: z.string().trim().optional(),
  GROQ_TIMEOUT_MS: z.coerce.number().int().positive().default(60000),
  // Groq's on_demand tier charges the FULL max_completion_tokens against both the
  // 8000 tokens-per-minute and (much larger) tokens-per-day budgets on every call,
  // regardless of how much output is actually used. With small per-chunk prompts,
  // 4000 reserved roughly half the per-minute budget on its own, capping throughput
  // to ~1 chunk/minute; this keeps each call's reservation tighter so more chunks fit
  // in each window. Item-level validation (testcase.service.ts) tolerates the rare
  // truncated case this trades off against.
  GROQ_MAX_COMPLETION_TOKENS: z.coerce.number().int().positive().default(2800),
  // Reasoning models (e.g. openai/gpt-oss-*) spend completion budget on reasoning
  // tokens; keeping this low prevents the JSON output from being truncated.
  GROQ_REASONING_EFFORT: z.enum(["low", "medium", "high"]).optional(),
  // Specs are split into batches of this many paths per Groq call, both to stay under the
  // TPM limit and to keep each call's output small enough not to hit the completion-token
  // budget mid-array (across every requested category, one path can already need several
  // test cases).
  GROQ_MAX_PATHS_PER_CHUNK: z.coerce.number().int().positive().default(2),
  MAX_TEST_CASES: z.coerce.number().int().positive().default(50)
});

export const env = EnvironmentSchema.parse(process.env);
export const groqEnabled = Boolean(env.GROQ_API_KEY && env.GROQ_MODEL);
