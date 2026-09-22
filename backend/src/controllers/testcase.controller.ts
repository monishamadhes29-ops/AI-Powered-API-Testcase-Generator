import type { RequestHandler } from "express";
import { ConfirmGenerationSchema, GenerateTestCasesRequestSchema } from "../schemas/api.schemas.js";
import { sessionStore } from "../store/session.store.js";
import { AppError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";
import { generateTestCases, summarizeTestCases } from "../services/testcase.service.js";

export const confirmTestGeneration: RequestHandler = (req, res) => {
  ConfirmGenerationSchema.parse(req.body);
  const session = sessionStore.get(req.params.sessionId);
  if (!session) throw new AppError(404, "SESSION_NOT_FOUND", "The processing session was not found or has expired.");
  if (!session.validationReport?.isValid) {
    throw new AppError(409, "SWAGGER_NOT_VALID", "Correct all Swagger errors before generating test cases.", session.validationReport?.errors);
  }
  session.testGenerationConfirmed = true;
  sessionStore.set(session);
  res.json({ success: true, data: { sessionId: session.sessionId, confirmed: true } });
};

export const generateCases: RequestHandler = async (req, res) => {
  // If the client gives up (closed tab, retried elsewhere) before this resolves, stop
  // making Groq calls on its behalf — an abandoned request would otherwise keep burning
  // the shared per-minute token budget and slow down every other in-flight generation.
  const controller = new AbortController();
  res.on("close", () => { if (!res.writableEnded) controller.abort(); });

  try {
    const input = GenerateTestCasesRequestSchema.parse(req.body);
    const session = sessionStore.get(input.sessionId);
    if (!session) throw new AppError(404, "SESSION_NOT_FOUND", "The processing session was not found or has expired.");
    if (!session.validationReport?.isValid) throw new AppError(409, "SWAGGER_NOT_VALID", "The active Swagger document is invalid.");
    if (!session.testGenerationConfirmed) throw new AppError(409, "GENERATION_NOT_CONFIRMED", "Confirm testcase generation before proceeding.");

    const result = await generateTestCases(session.activeSpecification, input.categories, controller.signal);
    session.testCases = result.testCases;
    session.generationSource = result.source;
    session.generationModel = result.model;
    sessionStore.set(session);
    res.json({
      success: true,
      data: {
        sessionId: session.sessionId,
        generationSource: result.source,
        generationModel: result.model,
        summary: summarizeTestCases(result.testCases),
        testCases: result.testCases,
        partial: result.partial
      }
    });
  } catch (error) {
    logger.error({ error, sessionId: req.params.sessionId }, "Testcase generation failed");
    throw error;
  }
};

export const getCases: RequestHandler = (req, res) => {
  const session = sessionStore.get(req.params.sessionId);
  if (!session) throw new AppError(404, "SESSION_NOT_FOUND", "The processing session was not found or has expired.");
  res.json({
    success: true,
    data: { testCases: session.testCases, generationSource: session.generationSource, generationModel: session.generationModel }
  });
};
