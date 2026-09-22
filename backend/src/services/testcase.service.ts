import type { ApiTestCase, JsonObject, TestCaseCategory } from "../types/index.js";
import { ApiTestCaseSchema } from "../schemas/llm.schemas.js";
import { callGroqJson, isGroqEnabled } from "./groq.service.js";
import { TEST_CASE_SYSTEM_PROMPT } from "./prompts.js";
import { env } from "../config/environment.js";
import { logger } from "../utils/logger.js";
import { AppError } from "../utils/errors.js";

function deduplicate(cases: ApiTestCase[]): ApiTestCase[] {
  const seen = new Set<string>();
  return cases.filter((testCase) => {
    const key = `${testCase.method}|${testCase.endpoint}|${testCase.category}|${testCase.title.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const PRIORITY_RANK: Record<ApiTestCase["priority"], number> = { High: 0, Medium: 1, Low: 2 };

// Round-robins across categories (highest priority first within each) so the cap
// spreads across positive/negative/boundary/etc. instead of one category eating the
// whole budget. Cases within a category stay in spec order, which already alternates
// across endpoints, so endpoint coverage stays broad too.
function limitTestCases(cases: ApiTestCase[], max: number): ApiTestCase[] {
  if (cases.length <= max) return cases;

  const groups = new Map<string, ApiTestCase[]>();
  for (const testCase of cases) {
    const group = groups.get(testCase.category);
    if (group) group.push(testCase);
    else groups.set(testCase.category, [testCase]);
  }
  for (const group of groups.values()) {
    group.sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]);
  }

  const groupList = [...groups.values()];
  const selected: ApiTestCase[] = [];
  for (let round = 0; selected.length < max && round < Math.max(...groupList.map((g) => g.length)); round++) {
    for (const group of groupList) {
      if (selected.length >= max) break;
      if (round < group.length) selected.push(group[round]);
    }
  }
  return selected;
}

function renumber(cases: ApiTestCase[]): ApiTestCase[] {
  return cases.map((testCase, index) => ({ ...testCase, testCaseId: `TC-API-${String(index + 1).padStart(3, "0")}` }));
}

// Fields that help a human reader but add tokens without helping test-case derivation.
const STRIP_KEYS = new Set(["description", "example", "examples", "externalDocs", "termsOfService", "contact", "license"]);

function trimSpecification(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(trimSpecification);
  if (value && typeof value === "object") {
    const result: JsonObject = {};
    for (const [key, val] of Object.entries(value as JsonObject)) {
      if (STRIP_KEYS.has(key)) continue;
      result[key] = trimSpecification(val);
    }
    return result;
  }
  return value;
}

// Splits paths into small batches so each Groq call's prompt stays well under
// the provider's tokens-per-minute limit, regardless of total spec size.
function chunkPaths(paths: JsonObject, size: number): JsonObject[] {
  const entries = Object.entries(paths);
  if (entries.length === 0) return [paths];
  const chunks: JsonObject[] = [];
  for (let i = 0; i < entries.length; i += size) {
    chunks.push(Object.fromEntries(entries.slice(i, i + size)));
  }
  return chunks;
}

// Validates each test case individually (rather than the whole array as one schema) so
// that a response truncated mid-object by the completion-token budget — the last element
// missing its trailing fields — only drops that one incomplete case instead of the entire
// chunk's otherwise-valid output.
async function groqCases(specification: JsonObject, categories: TestCaseCategory[], signal?: AbortSignal) {
  const system = TEST_CASE_SYSTEM_PROMPT;
  const user = JSON.stringify({ categories, specification });
  const output = await callGroqJson(system, user, signal);

  const rawCases = output && typeof output === "object" && Array.isArray((output as JsonObject).testCases)
    ? (output as { testCases: unknown[] }).testCases
    : undefined;
  if (!rawCases) {
    throw new AppError(502, "GROQ_OUTPUT_INVALID", "Groq returned test cases that do not match the required schema.");
  }

  const validCases: ApiTestCase[] = [];
  const droppedIssues: unknown[] = [];
  for (const [index, raw] of rawCases.entries()) {
    const result = ApiTestCaseSchema.safeParse(raw);
    if (result.success) validCases.push(result.data);
    else droppedIssues.push({ index, issues: result.error.issues });
  }

  if (droppedIssues.length > 0) {
    logger.warn(
      { droppedCount: droppedIssues.length, totalCount: rawCases.length, issues: droppedIssues.slice(0, 5) },
      "Groq returned some malformed test cases (likely output truncation); dropping them and keeping the rest."
    );
  }
  if (validCases.length === 0) {
    throw new AppError(
      502,
      "GROQ_OUTPUT_INVALID",
      "Groq returned test cases that do not match the required schema.",
      { issues: droppedIssues.slice(0, 10) }
    );
  }
  return validCases;
}

function finalize(cases: ApiTestCase[]): ApiTestCase[] {
  return renumber(limitTestCases(deduplicate(cases), env.MAX_TEST_CASES));
}

// Test cases are generated exclusively by Groq (the LLM). There is intentionally no
// hardcoded/deterministic fallback: if Groq is not configured or the request fails,
// generation errors out so the application never returns non-LLM results.
export async function generateTestCases(specification: JsonObject, categories: TestCaseCategory[], signal?: AbortSignal) {
  if (!isGroqEnabled()) {
    throw new AppError(
      503,
      "GROQ_NOT_CONFIGURED",
      "Groq is not configured. Set GROQ_API_KEY and GROQ_MODEL in the backend .env to generate test cases."
    );
  }

  const trimmed = trimSpecification(specification) as JsonObject;
  const paths = (trimmed.paths as JsonObject | undefined) ?? {};
  const pathChunks = chunkPaths(paths, env.GROQ_MAX_PATHS_PER_CHUNK);

  // Each chunk is an independent Groq call; one chunk exhausting its rate-limit retries
  // (common on larger specs — see the GROQ_MAX_COMPLETION_TOKENS comment in environment.ts)
  // must not throw away every other chunk that already succeeded. Keep going and only
  // fail the whole request if nothing came back at all.
  const generated: ApiTestCase[] = [];
  let lastFailure: unknown;
  let failedChunks = 0;
  for (const [index, pathChunk] of pathChunks.entries()) {
    if (signal?.aborted) {
      logger.warn({ chunk: index + 1, of: pathChunks.length }, "Client disconnected; stopping test case generation early.");
      break;
    }
    const chunkSpec: JsonObject = { ...trimmed, paths: pathChunk };
    try {
      generated.push(...(await groqCases(chunkSpec, categories, signal)));
    } catch (error) {
      failedChunks += 1;
      lastFailure = error;
      logger.error(
        { error, chunk: index + 1, of: pathChunks.length },
        "Groq generation failed for a spec chunk; continuing with remaining chunks."
      );
    }
  }

  if (generated.length === 0) {
    if (lastFailure instanceof AppError) throw lastFailure;
    throw new AppError(502, "GROQ_EMPTY_RESULT", "Groq returned no test cases for the supplied specification.");
  }

  if (failedChunks > 0) {
    logger.warn(
      { failedChunks, totalChunks: pathChunks.length },
      "Some spec chunks failed during test case generation; returning partial results."
    );
  }

  logger.info({ count: generated.length, chunks: pathChunks.length, model: env.GROQ_MODEL }, "Generated test cases with Groq.");
  return {
    testCases: finalize(generated),
    source: "groq" as const,
    model: env.GROQ_MODEL,
    partial: failedChunks > 0
  };
}

export function summarizeTestCases(testCases: ApiTestCase[]) {
  const counts = Object.fromEntries([
    "positive", "negative", "boundary", "authentication", "authorization", "validation", "error-handling"
  ].map((category) => [category, testCases.filter((testCase) => testCase.category === category).length]));
  return { totalTestCases: testCases.length, ...counts };
}
