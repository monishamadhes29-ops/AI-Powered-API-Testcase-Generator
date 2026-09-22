import SwaggerParser from "@apidevtools/swagger-parser";
import YAML from "yaml";
import dns from "node:dns/promises";
import type { JsonObject, ValidationIssue, ValidationReport } from "../types/index.js";
import { AppError } from "../utils/errors.js";
import { env } from "../config/environment.js";

const METHODS = ["get", "post", "put", "patch", "delete", "head", "options", "trace"];

function isPrivateIPv4(address: string): boolean {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((octet) => Number.isNaN(octet))) return true;
  const [a, b] = octets;
  return a === 10 || a === 127 || a === 0
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168);
}

function isPrivateIPv6(address: string): boolean {
  const lower = address.toLowerCase();
  if (lower === "::1") return true;
  if (lower.includes(".")) {
    // IPv4-mapped/compatible address, e.g. ::ffff:127.0.0.1
    const ipv4Part = lower.split(":").pop();
    if (ipv4Part?.includes(".")) return isPrivateIPv4(ipv4Part);
  }
  const firstGroup = lower.split(":")[0];
  return /^fe[89ab]/.test(firstGroup) // fe80::/10 link-local
    || /^f[cd]/.test(firstGroup); // fc00::/7 unique local
}

// Blocks the common SSRF targets (loopback, private/link-local ranges, cloud metadata
// hosts) by resolving the hostname before fetching. This is a pre-check, not a fully
// DNS-rebinding-proof guard — reasonable for this app's scale.
async function assertUrlIsFetchable(parsed: URL): Promise<void> {
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new AppError(400, "URL_NOT_ALLOWED", "Only http and https URLs are supported.");
  }

  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await dns.lookup(parsed.hostname, { all: true });
  } catch {
    throw new AppError(400, "URL_FETCH_FAILED", "The host in the supplied URL could not be resolved.");
  }

  const isBlocked = addresses.length === 0 || addresses.some(({ address, family }) =>
    family === 4 ? isPrivateIPv4(address) : isPrivateIPv6(address));
  if (isBlocked) {
    throw new AppError(400, "URL_NOT_ALLOWED", "The supplied URL points to a disallowed host.");
  }
}

const isHtml = (contentType: string) => contentType.toLowerCase().includes("text/html");

function deriveFileName(target: URL, contentType: string): string {
  const pathName = target.pathname.toLowerCase();
  if (pathName.endsWith(".json") || pathName.endsWith(".yaml") || pathName.endsWith(".yml")) {
    return target.pathname.split("/").pop() || "spec.yaml";
  }
  return contentType.toLowerCase().includes("json") ? "spec.json" : "spec.yaml";
}

function safeResolve(value: string, base: URL): URL | undefined {
  try {
    return new URL(value, base);
  } catch {
    return undefined;
  }
}

// Fetches a URL with the same SSRF guard, timeout, and size cap regardless of whether
// it's the page the user pasted, a discovered spec URL, or a well-known-path guess.
async function fetchCapped(target: URL, maxBytes: number): Promise<{ contentType: string; buffer: Buffer }> {
  await assertUrlIsFetchable(target);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.URL_FETCH_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(target, { signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new AppError(504, "URL_FETCH_TIMEOUT", "Fetching the specification timed out.");
    }
    throw new AppError(400, "URL_FETCH_FAILED", "Could not fetch the specification from the supplied URL.");
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) {
    throw new AppError(400, "URL_FETCH_FAILED", `Fetching the specification failed (HTTP ${response.status}).`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new AppError(400, "URL_FETCH_FAILED", "The response from the supplied URL had no body.");

  const chunks: Buffer[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new AppError(400, "URL_RESPONSE_TOO_LARGE", `The specification exceeds the ${env.MAX_FILE_SIZE_MB}MB size limit.`);
    }
    chunks.push(Buffer.from(value));
  }

  return { contentType: response.headers.get("content-type") ?? "", buffer: Buffer.concat(chunks) };
}

// Swagger UI / ReDoc pages declare their spec location as `url: "..."`, either inline
// or in a loader script (e.g. swagger-initializer.js). Best-effort extraction only —
// callers fall back to well-known paths if this finds nothing.
const SPEC_URL_PATTERN = /\burl\s*:\s*["']([^"']+)["']/;

async function discoverSpecUrl(pageUrl: URL, html: string, maxBytes: number): Promise<URL | undefined> {
  const direct = html.match(SPEC_URL_PATTERN)?.[1];
  if (direct) {
    const resolved = safeResolve(direct, pageUrl);
    if (resolved) return resolved;
  }

  const scriptSrc = html.match(/<script[^>]+src=["']([^"']*(?:initializer|swagger-config)[^"']*)["']/i)?.[1];
  const scriptUrl = scriptSrc ? safeResolve(scriptSrc, pageUrl) : undefined;
  if (!scriptUrl) return undefined;

  try {
    const script = await fetchCapped(scriptUrl, maxBytes);
    const match = script.buffer.toString("utf-8").match(SPEC_URL_PATTERN)?.[1];
    return match ? safeResolve(match, scriptUrl) : undefined;
  } catch {
    return undefined;
  }
}

const WELL_KNOWN_SPEC_PATHS = ["/v3/api-docs", "/v2/swagger.json", "/swagger.json", "/openapi.json", "/openapi.yaml", "/api-docs"];

export async function fetchSpecificationFromUrl(url: string): Promise<{ fileName: string; buffer: Buffer }> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new AppError(400, "URL_NOT_ALLOWED", "The supplied URL is not valid.");
  }

  const maxBytes = env.MAX_FILE_SIZE_MB * 1024 * 1024;
  const first = await fetchCapped(parsed, maxBytes);
  if (!isHtml(first.contentType)) {
    return { fileName: deriveFileName(parsed, first.contentType), buffer: first.buffer };
  }

  // The URL returned an HTML page (e.g. a Swagger UI viewer) instead of the raw spec.
  // Try to discover the actual document: first from the page/loader script, then by
  // guessing well-known spec paths on the same origin.
  const discovered = await discoverSpecUrl(parsed, first.buffer.toString("utf-8"), maxBytes);
  const candidates = [
    ...(discovered ? [discovered] : []),
    ...WELL_KNOWN_SPEC_PATHS.map((path) => new URL(path, parsed))
  ];

  for (const candidate of candidates) {
    try {
      const attempt = await fetchCapped(candidate, maxBytes);
      if (!isHtml(attempt.contentType)) {
        return { fileName: deriveFileName(candidate, attempt.contentType), buffer: attempt.buffer };
      }
    } catch {
      continue;
    }
  }

  throw new AppError(
    400,
    "URL_NOT_A_SPEC",
    "That URL returned an HTML page and no Swagger/OpenAPI document could be auto-discovered from it. Point to the raw JSON or YAML spec file instead (e.g. .../swagger.json or .../openapi.yaml)."
  );
}

export function parseSpecification(fileName: string, content: Buffer): {
  format: "yaml" | "json";
  specification: JsonObject;
} {
  const text = content.toString("utf-8").trim();
  if (!text) throw new AppError(400, "EMPTY_FILE", "The uploaded file is empty.");

  try {
    const format = fileName.toLowerCase().endsWith(".json") ? "json" : "yaml";
    const parsed = format === "json" ? JSON.parse(text) : YAML.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("The root document must be an object.");
    }
    return { format, specification: parsed as JsonObject };
  } catch (error) {
    const code = fileName.toLowerCase().endsWith(".json") ? "INVALID_JSON" : "INVALID_YAML";
    throw new AppError(400, code, `The uploaded ${code === "INVALID_JSON" ? "JSON" : "YAML"} cannot be parsed.`, {
      reason: error instanceof Error ? error.message : String(error)
    });
  }
}

function normalizeParserError(error: unknown): ValidationIssue[] {
  const message = error instanceof Error ? error.message : String(error);
  const pathMatch = message.match(/at\s+([\w./\[\]-]+)/i);
  return [{
    code: "OPENAPI_SCHEMA_ERROR",
    path: pathMatch?.[1] ?? "$",
    message,
    severity: "error"
  }];
}

function collectWarnings(specification: JsonObject): ValidationIssue[] {
  const warnings: ValidationIssue[] = [];
  const paths = specification.paths;
  if (!paths || typeof paths !== "object" || Array.isArray(paths)) {
    warnings.push({ code: "NO_PATHS", path: "paths", message: "The specification contains no API paths.", severity: "warning" });
    return warnings;
  }

  for (const [path, pathItem] of Object.entries(paths as Record<string, unknown>)) {
    if (!pathItem || typeof pathItem !== "object" || Array.isArray(pathItem)) continue;
    for (const method of METHODS) {
      const operation = (pathItem as Record<string, unknown>)[method];
      if (!operation || typeof operation !== "object" || Array.isArray(operation)) continue;
      const operationObject = operation as Record<string, unknown>;
      if (!operationObject.operationId) {
        warnings.push({
          code: "MISSING_OPERATION_ID",
          path: `paths.${path}.${method}`,
          message: "Operation ID is recommended for stable testcase traceability.",
          severity: "warning"
        });
      }
      if (!operationObject.summary && !operationObject.description) {
        warnings.push({
          code: "MISSING_OPERATION_DESCRIPTION",
          path: `paths.${path}.${method}`,
          message: "Operation summary or description is recommended.",
          severity: "warning"
        });
      }
    }
  }
  return warnings;
}

export async function validateSpecification(specification: JsonObject): Promise<ValidationReport> {
  let errors: ValidationIssue[] = [];
  try {
    await SwaggerParser.validate(structuredClone(specification) as never);
  } catch (error) {
    errors = normalizeParserError(error);
  }

  const warnings = collectWarnings(specification);
  const version = typeof specification.openapi === "string"
    ? specification.openapi
    : typeof specification.swagger === "string"
      ? specification.swagger
      : undefined;

  return {
    isValid: errors.length === 0,
    openApiVersion: version,
    errorCount: errors.length,
    warningCount: warnings.length,
    errors,
    warnings
  };
}

export function serializeSpecification(specification: JsonObject, format: "yaml" | "json"): string {
  return format === "json"
    ? JSON.stringify(specification, null, 2)
    : YAML.stringify(specification, { indent: 2 });
}

export function getSpecificationSummary(specification: JsonObject) {
  const info = (specification.info && typeof specification.info === "object")
    ? specification.info as Record<string, unknown>
    : {};
  const paths = (specification.paths && typeof specification.paths === "object")
    ? specification.paths as Record<string, unknown>
    : {};
  let totalOperations = 0;
  for (const pathItem of Object.values(paths)) {
    if (!pathItem || typeof pathItem !== "object" || Array.isArray(pathItem)) continue;
    totalOperations += METHODS.filter((method) => Boolean((pathItem as Record<string, unknown>)[method])).length;
  }
  const components = specification.components && typeof specification.components === "object"
    ? specification.components as Record<string, unknown>
    : {};
  const securitySchemes = components.securitySchemes && typeof components.securitySchemes === "object"
    ? Object.keys(components.securitySchemes as Record<string, unknown>).length
    : 0;

  return {
    title: typeof info.title === "string" ? info.title : "Untitled API",
    version: typeof info.version === "string" ? info.version : "Not specified",
    openApiVersion: typeof specification.openapi === "string" ? specification.openapi : specification.swagger,
    totalPaths: Object.keys(paths).length,
    totalOperations,
    securitySchemes
  };
}
