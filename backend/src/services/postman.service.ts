import converter from "openapi-to-postmanv2";
import type { JsonObject } from "../types/index.js";
import { AppError } from "../utils/errors.js";

function addBasicTests(items: unknown[]): void {
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const object = item as Record<string, unknown>;
    if (Array.isArray(object.item)) addBasicTests(object.item);
    if (object.request) {
      const events = Array.isArray(object.event) ? object.event : [];
      events.push({
        listen: "test",
        script: {
          type: "text/javascript",
          exec: [
            "pm.test('Response status is not a server error', function () {",
            "  pm.expect(pm.response.code).to.be.below(500);",
            "});",
            "pm.test('Response time is recorded', function () {",
            "  pm.expect(pm.response.responseTime).to.be.a('number');",
            "});"
          ]
        }
      });
      object.event = events;
    }
  }
}

export function createPostmanCollection(specification: JsonObject, includeBasicTests: boolean): Promise<JsonObject> {
  return new Promise((resolve, reject) => {
    converter.convert(
      { type: "json", data: specification },
      { folderStrategy: "Tags", requestParametersResolution: "Example", exampleParametersResolution: "Example" },
      (error: Error | null, result: { result: boolean; reason?: string; output?: Array<{ data: JsonObject }> }) => {
        if (error || !result.result || !result.output?.[0]?.data) {
          reject(new AppError(500, "POSTMAN_GENERATION_FAILED", result.reason || error?.message || "Postman conversion failed."));
          return;
        }
        const collection = result.output[0].data;
        if (includeBasicTests && Array.isArray(collection.item)) addBasicTests(collection.item);
        resolve(collection);
      }
    );
  });
}
