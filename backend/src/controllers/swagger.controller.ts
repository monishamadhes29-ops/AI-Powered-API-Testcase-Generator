import type { RequestHandler } from "express";
import { randomUUID } from "node:crypto";
import { sessionStore } from "../store/session.store.js";
import { fetchSpecificationFromUrl, parseSpecification, validateSpecification } from "../services/swagger.service.js";
import { AppError } from "../utils/errors.js";
import { CorrectSwaggerRequestSchema, SessionRequestSchema, UploadSwaggerUrlRequestSchema } from "../schemas/api.schemas.js";
import { correctSpecification } from "../services/correction.service.js";

async function buildUploadResponse(fileName: string, buffer: Buffer) {
  const parsed = parseSpecification(fileName, buffer);
  const validationReport = await validateSpecification(parsed.specification);
  const sessionId = randomUUID();
  const now = new Date();

  sessionStore.set({
    sessionId,
    originalFileName: fileName,
    inputFormat: parsed.format,
    originalSpecification: structuredClone(parsed.specification),
    activeSpecification: parsed.specification,
    validationReport,
    testGenerationConfirmed: false,
    testCases: [],
    createdAt: now,
    expiresAt: sessionStore.createExpiry()
  });

  return {
    sessionId,
    fileName,
    format: parsed.format,
    status: "uploaded" as const,
    validationReport
  };
}

export const uploadSwagger: RequestHandler = async (req, res) => {
  if (!req.file) throw new AppError(400, "FILE_REQUIRED", "Select a Swagger YAML or JSON file.");
  const data = await buildUploadResponse(req.file.originalname, req.file.buffer);
  res.status(201).json({ success: true, data });
};

export const uploadSwaggerFromUrl: RequestHandler = async (req, res) => {
  const { url } = UploadSwaggerUrlRequestSchema.parse(req.body);
  const { fileName, buffer } = await fetchSpecificationFromUrl(url);
  const data = await buildUploadResponse(fileName, buffer);
  res.status(201).json({ success: true, data });
};

export const validateSwagger: RequestHandler = async (req, res) => {
  const { sessionId } = SessionRequestSchema.parse(req.body);
  const session = sessionStore.get(sessionId);
  if (!session) throw new AppError(404, "SESSION_NOT_FOUND", "The processing session was not found or has expired.");
  session.validationReport = await validateSpecification(session.activeSpecification);
  sessionStore.set(session);
  res.json({ success: true, data: session.validationReport });
};

export const correctSwagger: RequestHandler = async (req, res) => {
  const input = CorrectSwaggerRequestSchema.parse(req.body);
  const session = sessionStore.get(input.sessionId);
  if (!session) throw new AppError(404, "SESSION_NOT_FOUND", "The processing session was not found or has expired.");

  if (session.validationReport?.isValid) {
    res.json({
      success: true,
      data: {
        correctionStatus: "not-required",
        source: "deterministic",
        isCorrectedSpecificationValid: true,
        changes: [],
        remainingErrors: []
      }
    });
    return;
  }

  const result = await correctSpecification(
    session.activeSpecification,
    session.validationReport?.errors ?? [],
    input.applySafeCorrectionsOnly
  );
  session.correctedSpecification = result.correctedSpecification;
  session.activeSpecification = result.correctedSpecification;
  session.correctionReport = result.report;
  session.validationReport = await validateSpecification(session.activeSpecification);
  sessionStore.set(session);

  res.json({ success: true, data: result.report });
};
