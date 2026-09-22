import multer from "multer";
import { env } from "../config/environment.js";
import { AppError } from "../utils/errors.js";

const allowedExtensions = [".yaml", ".yml", ".json"];

export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.MAX_FILE_SIZE_MB * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    const lowerName = file.originalname.toLowerCase();
    if (!allowedExtensions.some((extension) => lowerName.endsWith(extension))) {
      callback(new AppError(400, "INVALID_FILE_TYPE", "Only YAML, YML, and JSON files are supported."));
      return;
    }
    callback(null, true);
  }
});
