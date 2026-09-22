import { Router } from "express";
import { upload } from "../middleware/upload.js";
import { correctSwagger, uploadSwagger, uploadSwaggerFromUrl, validateSwagger } from "../controllers/swagger.controller.js";
import { confirmTestGeneration, generateCases, getCases } from "../controllers/testcase.controller.js";
import { clearSession, getSummary } from "../controllers/session.controller.js";
import { generatePostman } from "../controllers/postman.controller.js";
import { exportExcel, exportJson, exportPostman, exportSwagger } from "../controllers/export.controller.js";
import { groqEnabled } from "../config/environment.js";

export const apiRouter = Router();

apiRouter.get("/health", (_req, res) => {
  res.json({ success: true, data: { status: "ok", groqConfigured: groqEnabled } });
});
apiRouter.post("/swagger/upload", upload.single("file"), uploadSwagger);
apiRouter.post("/swagger/upload-url", uploadSwaggerFromUrl);
apiRouter.post("/swagger/validate", validateSwagger);
apiRouter.post("/swagger/correct", correctSwagger);
apiRouter.post("/sessions/:sessionId/confirm-test-generation", confirmTestGeneration);
apiRouter.post("/testcases/generate", generateCases);
apiRouter.get("/sessions/:sessionId/testcases", getCases);
apiRouter.get("/sessions/:sessionId/summary", getSummary);
apiRouter.post("/postman/generate", generatePostman);
apiRouter.get("/sessions/:sessionId/export/json", exportJson);
apiRouter.get("/sessions/:sessionId/export/excel", exportExcel);
apiRouter.get("/sessions/:sessionId/export/swagger", exportSwagger);
apiRouter.get("/sessions/:sessionId/export/postman", exportPostman);
apiRouter.delete("/sessions/:sessionId", clearSession);
