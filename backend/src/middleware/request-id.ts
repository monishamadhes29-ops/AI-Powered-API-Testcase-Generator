import type { RequestHandler } from "express";
import { randomUUID } from "node:crypto";

export const requestIdMiddleware: RequestHandler = (req, res, next) => {
  const requestId = req.headers["x-request-id"]?.toString() || randomUUID();
  req.headers["x-request-id"] = requestId;
  res.setHeader("x-request-id", requestId);
  next();
};
