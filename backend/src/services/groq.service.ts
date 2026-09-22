import { env, groqEnabled } from "../config/environment.js";
import { AppError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";

export function isGroqEnabled(): boolean {
  return groqEnabled;
}

// Groq's on_demand tier enforces a tokens-per-minute cap shared across all calls in the
// same minute. Chunked spec generation makes several calls back to back, so a later chunk
// can hit HTTP 429 even though each individual request is small. Groq's error message tells
// us exactly how long to wait, so retry instead of failing the whole generation.
const MAX_RATE_LIMIT_RETRIES = 4;
const DEFAULT_RETRY_DELAY_MS = 5000;
// Groq's retry-after can legitimately be minutes (e.g. a daily-quota reset), which would
// otherwise leave this request hanging with no feedback for as long as Groq asks. Cap the
// wait so a chunk fails fast and the caller can move on to the next one / surface an error,
// instead of the whole HTTP request looking frozen.
const MAX_RETRY_DELAY_MS = 20_000;

// Abortable so a client that gave up (closed tab, retried elsewhere) doesn't leave this
// process sleeping through a rate-limit backoff and burning the shared per-minute token
// budget that a fresh request needs.
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new AppError(499, "CLIENT_ABORTED", "The client disconnected before generation finished.")); return; }
    const timer = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new AppError(499, "CLIENT_ABORTED", "The client disconnected before generation finished."));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function parseRetryDelayMs(response: Response, body: string): number {
  const header = response.headers.get("retry-after");
  if (header) {
    const seconds = Number(header);
    if (!Number.isNaN(seconds)) return Math.ceil(seconds * 1000) + 250;
  }
  const match = body.match(/try again in ([\d.]+)s/i);
  if (match) return Math.ceil(Number(match[1]) * 1000) + 250;
  return DEFAULT_RETRY_DELAY_MS;
}

async function requestOnce(systemPrompt: string, userPrompt: string, signal?: AbortSignal): Promise<unknown> {
  if (signal?.aborted) throw new AppError(499, "CLIENT_ABORTED", "The client disconnected before generation finished.");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.GROQ_TIMEOUT_MS);
  const onExternalAbort = () => controller.abort();
  signal?.addEventListener("abort", onExternalAbort, { once: true });

  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.GROQ_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: env.GROQ_MODEL,
        temperature: 0.1,
        max_completion_tokens: env.GROQ_MAX_COMPLETION_TOKENS,
        // Only sent for models that support it; keeps reasoning models from
        // spending their whole output budget on reasoning and truncating the JSON.
        ...(env.GROQ_REASONING_EFFORT ? { reasoning_effort: env.GROQ_REASONING_EFFORT } : {}),
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ]
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      const body = await response.text();
      let detail = body.slice(0, 500);
      let failedGeneration: string | undefined;
      try {
        const parsed = JSON.parse(body) as { error?: { message?: string; failed_generation?: string } };
        if (parsed.error?.message) detail = parsed.error.message;
        failedGeneration = parsed.error?.failed_generation;
      } catch {
        // body was not JSON; keep the raw snippet
      }
      if (response.status === 429) {
        const retryDelayMs = parseRetryDelayMs(response, body);
        throw new AppError(
          429,
          "GROQ_RATE_LIMITED",
          `Groq request failed (HTTP 429): ${detail}`,
          { status: response.status, body: body.slice(0, 1000), retryDelayMs }
        );
      }
      // Groq's constrained JSON-mode decoder occasionally fails to produce valid JSON for
      // a given prompt (often a transient hiccup on reasoning models); worth one retry
      // before giving up, since a fresh sampling attempt frequently succeeds.
      if (response.status === 400 && /failed to generate json/i.test(detail)) {
        throw new AppError(
          400,
          "GROQ_JSON_GENERATION_FAILED",
          `Groq request failed (HTTP 400): ${detail}`,
          { status: response.status, failedGeneration: failedGeneration?.slice(0, 1000), retryDelayMs: 1500 }
        );
      }
      throw new AppError(
        response.status,
        "GROQ_REQUEST_FAILED",
        `Groq request failed (HTTP ${response.status}): ${detail}`,
        { status: response.status, body: body.slice(0, 1000) }
      );
    }

    const payload = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) throw new AppError(502, "GROQ_EMPTY_RESPONSE", "Groq returned an empty response.");

    try {
      return JSON.parse(content);
    } catch {
      throw new AppError(502, "GROQ_INVALID_JSON", "Groq did not return valid JSON.", { content: content.slice(0, 1000) });
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      if (signal?.aborted) throw new AppError(499, "CLIENT_ABORTED", "The client disconnected before generation finished.");
      throw new AppError(504, "GROQ_TIMEOUT", "Groq request timed out.");
    }
    const reason = error instanceof Error ? error.message : String(error);
    throw new AppError(502, "GROQ_REQUEST_FAILED", `Groq request failed: ${reason}`, { reason });
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", onExternalAbort);
  }
}

export async function callGroqJson(systemPrompt: string, userPrompt: string, signal?: AbortSignal): Promise<unknown> {
  if (!groqEnabled || !env.GROQ_API_KEY || !env.GROQ_MODEL) {
    throw new AppError(503, "GROQ_NOT_CONFIGURED", "Groq is not configured on the backend.");
  }

  for (let attempt = 0; ; attempt++) {
    try {
      return await requestOnce(systemPrompt, userPrompt, signal);
    } catch (error) {
      const isRetryable = error instanceof AppError
        && (error.code === "GROQ_RATE_LIMITED" || error.code === "GROQ_JSON_GENERATION_FAILED");
      if (!isRetryable || attempt >= MAX_RATE_LIMIT_RETRIES) throw error;

      const requestedDelayMs = (error.details as { retryDelayMs?: number } | undefined)?.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
      if (requestedDelayMs > MAX_RETRY_DELAY_MS) {
        logger.warn(
          { code: error.code, requestedDelayMs, maxDelayMs: MAX_RETRY_DELAY_MS },
          "Groq asked for a longer wait than this request will tolerate; failing this chunk instead of blocking."
        );
        throw error;
      }
      logger.warn({ attempt: attempt + 1, code: error.code, retryDelayMs: requestedDelayMs }, "Groq request failed transiently; retrying after delay.");
      await sleep(requestedDelayMs, signal);
    }
  }
}
