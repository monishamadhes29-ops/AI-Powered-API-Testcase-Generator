import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";
import { AppError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";

export const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  const requestId = req.headers["x-request-id"];

  if (error instanceof ZodError) {
    res.status(400).json({
      success: false,
      error: {
        code: "INPUT_VALIDATION_FAILED",
        message: "The request payload is invalid.",
        details: error.flatten()
      },
      requestId
    });
    return;
  }

  if (error instanceof AppError) {
    res.status(error.statusCode).json({
      success: false,
      error: {
        code: error.code,
        message: error.message,
        details: error.details
      },
      requestId
    });
    return;
  }

  logger.error({ error, requestId }, "Unhandled application error");
  res.status(500).json({
    success: false,
    error: {
      code: "INTERNAL_SERVER_ERROR",
      message: "An unexpected error occurred."
    },
    requestId
  });
};
