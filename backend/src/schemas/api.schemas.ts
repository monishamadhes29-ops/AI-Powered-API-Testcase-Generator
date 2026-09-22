import { z } from "zod";

export const SessionIdSchema = z.string().uuid();

export const SessionRequestSchema = z.object({
  sessionId: SessionIdSchema
});

export const UploadSwaggerUrlRequestSchema = z.object({
  url: z.string().trim().url()
});

export const CorrectSwaggerRequestSchema = z.object({
  sessionId: SessionIdSchema,
  applySafeCorrectionsOnly: z.boolean().default(false)
});

export const ConfirmGenerationSchema = z.object({
  confirmed: z.literal(true)
});

export const TestCaseCategorySchema = z.enum([
  "positive",
  "negative",
  "boundary",
  "authentication",
  "authorization",
  "validation",
  "error-handling"
]);

export const GenerateTestCasesRequestSchema = z.object({
  sessionId: SessionIdSchema,
  categories: z.array(TestCaseCategorySchema).min(1).default([
    "positive",
    "negative",
    "boundary",
    "authentication",
    "authorization",
    "validation",
    "error-handling"
  ])
});

export const GeneratePostmanRequestSchema = z.object({
  sessionId: SessionIdSchema,
  includeBasicTests: z.boolean().default(true)
});
