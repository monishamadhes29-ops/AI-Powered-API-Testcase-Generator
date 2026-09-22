import type { RequestHandler } from "express";
import { sessionStore } from "../store/session.store.js";
import { AppError } from "../utils/errors.js";
import { createExcel } from "../services/export.service.js";
import { serializeSpecification } from "../services/swagger.service.js";

function getSession(sessionId: string) {
  const session = sessionStore.get(sessionId);
  if (!session) throw new AppError(404, "SESSION_NOT_FOUND", "The processing session was not found or has expired.");
  return session;
}

export const exportJson: RequestHandler = (req, res) => {
  const session = getSession(req.params.sessionId);
  if (!session.testCases.length) throw new AppError(409, "NO_TESTCASES", "Generate test cases before downloading JSON.");
  res.setHeader("Content-Disposition", "attachment; filename=api-testcases.json");
  res.type("application/json").send(JSON.stringify({ summary: { total: session.testCases.length }, testCases: session.testCases }, null, 2));
};

export const exportExcel: RequestHandler = async (req, res) => {
  const session = getSession(req.params.sessionId);
  if (!session.testCases.length) throw new AppError(409, "NO_TESTCASES", "Generate test cases before downloading Excel.");
  const buffer = await createExcel(session.testCases);
  res.setHeader("Content-Disposition", "attachment; filename=api-testcases.xlsx");
  res.type("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet").send(buffer);
};

export const exportSwagger: RequestHandler = (req, res) => {
  const session = getSession(req.params.sessionId);
  const format = session.inputFormat;
  const extension = format === "json" ? "json" : "yaml";
  res.setHeader("Content-Disposition", `attachment; filename=corrected-swagger.${extension}`);
  res.type(format === "json" ? "application/json" : "application/yaml").send(serializeSpecification(session.activeSpecification, format));
};

export const exportPostman: RequestHandler = (req, res) => {
  const session = getSession(req.params.sessionId);
  if (!session.postmanCollection) throw new AppError(409, "POSTMAN_NOT_GENERATED", "Generate the Postman collection before downloading it.");
  res.setHeader("Content-Disposition", "attachment; filename=api-postman-collection.json");
  res.type("application/json").send(JSON.stringify(session.postmanCollection, null, 2));
};
