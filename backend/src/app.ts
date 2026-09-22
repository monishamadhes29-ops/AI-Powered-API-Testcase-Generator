import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import pinoHttp from "pino-http";
import { env } from "./config/environment.js";
import { logger } from "./utils/logger.js";
import { requestIdMiddleware } from "./middleware/request-id.js";
import { apiRouter } from "./routes/index.js";
import { errorHandler } from "./middleware/error-handler.js";

export const app = express();

app.disable("x-powered-by");
app.use(requestIdMiddleware);
app.use(pinoHttp({ logger }));
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(cors({ origin: env.CORS_ORIGIN.split(",").map((value) => value.trim()) }));
app.use(express.json({ limit: "2mb" }));
app.use(rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: true, legacyHeaders: false }));
app.use("/api/v1", apiRouter);
app.use((_req, res) => res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Route not found." } }));
app.use(errorHandler);
