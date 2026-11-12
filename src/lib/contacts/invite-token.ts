// Ticket 5 — invite link tokens. Server-only (node:crypto). 32 random bytes,
// base64url. Only the SHA-256 is stored; the raw token is shown once.
import { createHash, randomBytes } from "node:crypto";

const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;

export function newInviteToken(): string {
  return randomBytes(32).toString("base64url");
}

/** True if the text could be one of our tokens (cheap check before any lookup). */
export function isInviteTokenShape(raw: unknown): raw is string {
  return typeof raw === "string" && TOKEN_SHAPE.test(raw);
}

export function hashInviteToken(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}
