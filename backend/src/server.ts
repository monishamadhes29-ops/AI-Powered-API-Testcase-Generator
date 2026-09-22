import { app } from "./app.js";
import { env } from "./config/environment.js";
import { logger } from "./utils/logger.js";
import { sessionStore } from "./store/session.store.js";

const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT }, "Swagger API Testcase Generator backend started");
});

const cleanupTimer = setInterval(() => {
  const removed = sessionStore.cleanup();
  if (removed) logger.info({ removed }, "Expired sessions cleared");
}, 5 * 60_000);
cleanupTimer.unref();

function shutdown(signal: string) {
  logger.info({ signal }, "Shutting down");
  server.close(() => process.exit(0));
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
