import type { RequestHandler } from "express";
import { GeneratePostmanRequestSchema } from "../schemas/api.schemas.js";
import { createPostmanCollection } from "../services/postman.service.js";
import { sessionStore } from "../store/session.store.js";
import { AppError } from "../utils/errors.js";

export const generatePostman: RequestHandler = async (req, res) => {
  const input = GeneratePostmanRequestSchema.parse(req.body);
  const session = sessionStore.get(input.sessionId);
  if (!session) throw new AppError(404, "SESSION_NOT_FOUND", "The processing session was not found or has expired.");
  if (!session.validationReport?.isValid) throw new AppError(409, "SWAGGER_NOT_VALID", "The active Swagger document is invalid.");
  session.postmanCollection = await createPostmanCollection(session.activeSpecification, input.includeBasicTests);
  sessionStore.set(session);
  res.json({ success: true, data: { sessionId: session.sessionId, status: "generated" } });
};
