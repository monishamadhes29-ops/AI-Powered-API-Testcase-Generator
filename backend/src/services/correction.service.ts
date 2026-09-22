import type { CorrectionChange, CorrectionReport, JsonObject, ValidationIssue } from "../types/index.js";
import { GroqCorrectionOutputSchema } from "../schemas/llm.schemas.js";
import { callGroqJson, isGroqEnabled } from "./groq.service.js";
import { validateSpecification } from "./swagger.service.js";
import { CORRECTION_SYSTEM_PROMPT } from "./prompts.js";

const HTTP_METHODS = ["get", "post", "put", "patch", "delete", "head", "options", "trace"];

function applyDeterministicCorrections(input: JsonObject): { corrected: JsonObject; changes: CorrectionChange[] } {
  const corrected = structuredClone(input);
  const changes: CorrectionChange[] = [];

  if (!corrected.info || typeof corrected.info !== "object" || Array.isArray(corrected.info)) {
    corrected.info = { title: "API Specification", version: "1.0.0" };
    changes.push({ path: "info", issue: "Missing API information", correction: "Added title and version placeholders", confidence: 1 });
  } else {
    const info = corrected.info as Record<string, unknown>;
    if (!info.title) {
      info.title = "API Specification";
      changes.push({ path: "info.title", issue: "Missing API title", correction: "Added a neutral API title", confidence: 1 });
    }
    if (!info.version) {
      info.version = "1.0.0";
      changes.push({ path: "info.version", issue: "Missing API version", correction: "Added version 1.0.0", confidence: 1 });
    }
  }

  const paths = corrected.paths;
  if (paths && typeof paths === "object" && !Array.isArray(paths)) {
    for (const [path, pathItem] of Object.entries(paths as Record<string, unknown>)) {
      if (!pathItem || typeof pathItem !== "object" || Array.isArray(pathItem)) continue;
      for (const method of HTTP_METHODS) {
        const operation = (pathItem as Record<string, unknown>)[method];
        if (!operation || typeof operation !== "object" || Array.isArray(operation)) continue;
        const op = operation as Record<string, unknown>;
        if (!op.responses || typeof op.responses !== "object" || Array.isArray(op.responses)) {
          op.responses = { "200": { description: "Successful response" } };
          changes.push({
            path: `paths.${path}.${method}.responses`,
            issue: "Missing responses object",
            correction: "Added a generic 200 response description",
            confidence: 0.95
          });
          continue;
        }
        for (const [status, response] of Object.entries(op.responses as Record<string, unknown>)) {
          if (!response || typeof response !== "object" || Array.isArray(response)) continue;
          const responseObject = response as Record<string, unknown>;
          if (!responseObject.description) {
            responseObject.description = status === "default" ? "Default error response" : `HTTP ${status} response`;
            changes.push({
              path: `paths.${path}.${method}.responses.${status}.description`,
              issue: "Missing response description",
              correction: "Added a neutral response description",
              confidence: 1
            });
          }
        }
      }
    }
  }

  return { corrected, changes };
}

async function applyGroqCorrection(specification: JsonObject, errors: ValidationIssue[]) {
  const system = CORRECTION_SYSTEM_PROMPT;
  const user = JSON.stringify({ specification, deterministicValidationErrors: errors });
  const raw = await callGroqJson(system, user);
  return GroqCorrectionOutputSchema.parse(raw);
}

export async function correctSpecification(
  specification: JsonObject,
  validationErrors: ValidationIssue[],
  safeOnly: boolean
): Promise<{ correctedSpecification: JsonObject; report: CorrectionReport }> {
  const deterministic = applyDeterministicCorrections(specification);
  let active = deterministic.corrected;
  let changes = deterministic.changes;
  let source: CorrectionReport["source"] = "deterministic";
  let report = await validateSpecification(active);

  if (!safeOnly && !report.isValid && isGroqEnabled()) {
    const groq = await applyGroqCorrection(active, report.errors.length ? report.errors : validationErrors);
    active = groq.correctedSpecification;
    changes = [...changes, ...groq.changes];
    source = deterministic.changes.length ? "deterministic+groq" : "groq";
    report = await validateSpecification(active);
  }

  return {
    correctedSpecification: active,
    report: {
      correctionStatus: report.isValid ? "completed" : changes.length ? "partial" : "failed",
      source,
      isCorrectedSpecificationValid: report.isValid,
      changes,
      remainingErrors: report.errors
    }
  };
}
