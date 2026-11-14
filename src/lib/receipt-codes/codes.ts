// Ticket 3a — receipt code format and hashing (BRD v1.6 FR-06, HON-07). Server-only.
//
// Format (approved): 12 random Crockford base32 characters (60 bits) plus one
// check character, shown as XXXX-XXXX-XXXX-X. The QR carries the same code in
// a link (/r/<code>), so there is one secret per receipt and one stored hash.
// The check character (Luhn mod 32) catches typos and swapped neighbours, so a
// typo gets "check for typos" and does not count as a guess.
//
// Hashing: HMAC-SHA256 with a key derived (HKDF) from BETTER_AUTH_SECRET, so
// a copied database alone cannot be used to work out short codes.
import { createHash, createHmac, hkdfSync, randomBytes, randomInt } from "node:crypto";

/** Crockford base32: no I, L, O or U. */
export const CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const CODE_RANDOM_LENGTH = 12;
export const CODE_LENGTH = CODE_RANDOM_LENGTH + 1;

const BASE = CODE_ALPHABET.length; // 32

function valueOf(ch: string): number {
  return CODE_ALPHABET.indexOf(ch);
}

/** Luhn mod N check character for a string of alphabet characters. */
export function checkCharacter(body: string): string {
  let factor = 2;
  let sum = 0;
  for (let i = body.length - 1; i >= 0; i -= 1) {
    let addend = factor * valueOf(body[i]);
    factor = factor === 2 ? 1 : 2;
    addend = Math.floor(addend / BASE) + (addend % BASE);
    sum += addend;
  }
  return CODE_ALPHABET[(BASE - (sum % BASE)) % BASE];
}

function hasValidCheck(code: string): boolean {
  let factor = 1;
  let sum = 0;
  for (let i = code.length - 1; i >= 0; i -= 1) {
    let addend = factor * valueOf(code[i]);
    factor = factor === 2 ? 1 : 2;
    addend = Math.floor(addend / BASE) + (addend % BASE);
    sum += addend;
  }
  return sum % BASE === 0;
}

/** A new random code, unformatted (13 characters). */
export function generateCode(): string {
  let body = "";
  for (let i = 0; i < CODE_RANDOM_LENGTH; i += 1) body += CODE_ALPHABET[randomInt(BASE)];
  return body + checkCharacter(body);
}

/** XXXX-XXXX-XXXX-X for printing. */
export function formatCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4, 8)}-${code.slice(8, 12)}-${code.slice(12)}`;
}

/** Path the QR code links to. The page that serves it is Ticket 3b. */
export function qrPath(code: string): string {
  return `/r/${code}`;
}

/**
 * Turn whatever the person typed or scanned into the canonical 13-character
 * code, or null if it can't be one (wrong length, bad character, failed
 * check). Accepts the QR link, lower case, spaces and dashes, and the usual
 * Crockford look-alikes (O→0, I/L→1).
 */
export function normalizeCode(input: string): string | null {
  if (typeof input !== "string" || input.length > 200) return null;
  let text = input.trim();
  const slash = text.lastIndexOf("/");
  if (slash >= 0) text = text.slice(slash + 1);
  text = text
    .toUpperCase()
    .replace(/[\s-]/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");
  if (text.length !== CODE_LENGTH) return null;
  for (const ch of text) if (valueOf(ch) < 0) return null;
  return hasValidCheck(text) ? text : null;
}

/** Keys used for hashing. Derived from one server secret with HKDF. */
export interface HashKeys {
  codeKey: Buffer;
  ipKey: Buffer;
}

export function deriveHashKeys(secret: string): HashKeys {
  const derive = (info: string) =>
    Buffer.from(hkdfSync("sha256", secret, Buffer.alloc(0), info, 32));
  return {
    codeKey: derive("trufolks-receipt-code-v1"),
    ipKey: derive("trufolks-ip-address-v1"),
  };
}

const globalKeys = globalThis as typeof globalThis & { __trufolksHashKeys__?: HashKeys };

/**
 * Hash keys for the running server. Production requires BETTER_AUTH_SECRET
 * (gap 7). Locally, without it, a random per-process key is used — local
 * codes then stop working after a restart, which matches the in-memory
 * database being wiped on restart anyway.
 */
export function getServerHashKeys(): HashKeys {
  if (globalKeys.__trufolksHashKeys__) return globalKeys.__trufolksHashKeys__;
  const secret = process.env.BETTER_AUTH_SECRET?.trim();
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("BETTER_AUTH_SECRET must be set before receipt codes can be used");
    }
    console.warn("[receipt-codes] BETTER_AUTH_SECRET not set; using a temporary local key");
  }
  globalKeys.__trufolksHashKeys__ = deriveHashKeys(secret || randomBytes(32).toString("hex"));
  return globalKeys.__trufolksHashKeys__;
}

/** Stored hash of a normalised code. */
export function hashCode(code: string, keys: HashKeys): string {
  return createHmac("sha256", keys.codeKey).update(code).digest("hex");
}

/** Stored hash of a network address (used only for rate limits, P5). */
export function hashIp(ip: string | undefined | null, keys: HashKeys): string {
  return createHmac("sha256", keys.ipKey).update(ip?.trim() || "unknown").digest("hex");
}

/** A new device token: 32 random bytes, base64url (43 characters). */
export function generateDeviceToken(): string {
  return randomBytes(32).toString("base64url");
}

export function isDeviceTokenShape(token: unknown): token is string {
  return typeof token === "string" && /^[A-Za-z0-9_-]{43}$/.test(token);
}

/** Stored hash of a device token. The token is 256 random bits, so plain SHA-256 is enough. */
export function hashDeviceToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
