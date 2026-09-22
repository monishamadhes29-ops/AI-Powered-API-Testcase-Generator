import { z } from "zod";
import { TestCaseCategorySchema } from "./api.schemas.js";

export const CorrectionChangeSchema = z.object({
  path: z.string().min(1),
  issue: z.string().min(1),
  correction: z.string().min(1),
  confidence: z.number().min(0).max(1)
});

export const GroqCorrectionOutputSchema = z.object({
  correctedSpecification: z.record(z.string(), z.unknown()),
  changes: z.array(CorrectionChangeSchema)
});

export const ApiTestCaseSchema = z.object({
  testCaseId: z.string().min(1),
  operationId: z.string().optional(),
  endpoint: z.string().min(1),
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "TRACE"]),
  category: TestCaseCategorySchema,
  title: z.string().min(5),
  priority: z.enum(["High", "Medium", "Low"]),
  preconditions: z.array(z.string()),
  headers: z.record(z.string(), z.unknown()),
  pathParameters: z.record(z.string(), z.unknown()),
  queryParameters: z.record(z.string(), z.unknown()),
  requestBody: z.unknown().optional(),
  steps: z.array(z.string()).min(1),
  expectedStatusCode: z.number().int().min(100).max(599),
  expectedResult: z.string().min(5),
  sourceReferences: z.array(z.string()).min(1)
});

export const GroqTestCaseOutputSchema = z.object({
  testCases: z.array(ApiTestCaseSchema)
});
