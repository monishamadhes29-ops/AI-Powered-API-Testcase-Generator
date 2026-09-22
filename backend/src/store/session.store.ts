import { env } from "../config/environment.js";
import type { ProcessingSession } from "../types/index.js";

class SessionStore {
  private readonly sessions = new Map<string, ProcessingSession>();

  set(session: ProcessingSession): void {
    this.sessions.set(session.sessionId, session);
  }

  get(sessionId: string): ProcessingSession | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) return undefined;
    if (session.expiresAt.getTime() <= Date.now()) {
      this.sessions.delete(sessionId);
      return undefined;
    }
    return session;
  }

  delete(sessionId: string): boolean {
    return this.sessions.delete(sessionId);
  }

  cleanup(): number {
    let removed = 0;
    for (const [id, session] of this.sessions.entries()) {
      if (session.expiresAt.getTime() <= Date.now()) {
        this.sessions.delete(id);
        removed += 1;
      }
    }
    return removed;
  }

  createExpiry(): Date {
    return new Date(Date.now() + env.SESSION_TTL_MINUTES * 60_000);
  }
}

export const sessionStore = new SessionStore();
