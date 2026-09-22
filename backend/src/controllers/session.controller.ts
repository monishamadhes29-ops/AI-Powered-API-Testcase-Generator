import type { RequestHandler } from "express";
import { sessionStore } from "../store/session.store.js";
import { AppError } from "../utils/errors.js";
import { createSessionSummary } from "../services/summary.service.js";

export const getSummary: RequestHandler = (req, res) => {
  const session = sessionStore.get(req.params.sessionId);
  if (!session) throw new AppError(404, "SESSION_NOT_FOUND", "The processing session was not found or has expired.");
  res.json({ success: true, data: createSessionSummary(session) });
};

export const clearSession: RequestHandler = (req, res) => {
  const removed = sessionStore.delete(req.params.sessionId);
  if (!removed) throw new AppError(404, "SESSION_NOT_FOUND", "The processing session was not found or has expired.");
  res.json({ success: true, data: { sessionId: req.params.sessionId, status: "cleared" } });
};
