// Ticket 3a — receipt code format, check character and hashing. Pure, no database.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CODE_ALPHABET,
  CODE_LENGTH,
  checkCharacter,
  deriveHashKeys,
  formatCode,
  generateCode,
  generateDeviceToken,
  hashCode,
  hashDeviceToken,
  hashIp,
  isDeviceTokenShape,
  normalizeCode,
  qrPath,
} from "./codes.ts";
import { CODE_OUTCOMES, GENERATE_OUTCOMES, codeMessage, generateMessage } from "./messages.ts";

const keys = deriveHashKeys("test-secret-not-real-0123456789abcdef");

test("codes are 13 Crockford characters with a valid check character", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 500; i += 1) {
    const code = generateCode();
    assert.equal(code.length, CODE_LENGTH);
    for (const ch of code) assert.ok(CODE_ALPHABET.includes(ch), `bad character ${ch}`);
    assert.equal(normalizeCode(code), code);
    seen.add(code);
  }
  assert.equal(seen.size, 500, "codes should not repeat");
});

test("printed format is XXXX-XXXX-XXXX-X and reads back", () => {
  const code = generateCode();
  const printed = formatCode(code);
  assert.match(printed, /^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]$/);
  assert.equal(normalizeCode(printed), code);
  assert.equal(normalizeCode(printed.toLowerCase()), code);
  assert.equal(normalizeCode(` ${printed.replace(/-/g, " ")} `), code);
  assert.equal(normalizeCode(`https://trufolks.com${qrPath(code)}`), code);
});

test("look-alike letters are read as digits", () => {
  const body = "0000111100AB";
  const code = body + checkCharacter(body);
  assert.equal(normalizeCode(code.replace(/0/g, "O").replace(/1/g, "l")), code);
});

test("check character catches every single typo and neighbour swap", () => {
  for (let n = 0; n < 50; n += 1) {
    const code = generateCode();
    for (let i = 0; i < code.length; i += 1) {
      for (const ch of CODE_ALPHABET) {
        if (ch === code[i]) continue;
        const typo = code.slice(0, i) + ch + code.slice(i + 1);
        assert.equal(normalizeCode(typo), null, `typo not caught: ${typo}`);
      }
    }
    for (let i = 0; i < code.length - 1; i += 1) {
      if (code[i] === code[i + 1]) continue;
      const swapped = code.slice(0, i) + code[i + 1] + code[i] + code.slice(i + 2);
      // Luhn mod N misses one swap pair (0 <-> last letter); everything else is caught.
      const missable = new Set([code[i], code[i + 1]]);
      if (missable.has("0") && missable.has("Z")) continue;
      assert.equal(normalizeCode(swapped), null, `swap not caught: ${swapped}`);
    }
  }
});

test("wrong length, bad characters and junk are rejected", () => {
  assert.equal(normalizeCode(""), null);
  assert.equal(normalizeCode("ABC"), null);
  assert.equal(normalizeCode(generateCode() + "0"), null);
  assert.equal(normalizeCode("UUUUUUUUUUUUU"), null);
  assert.equal(normalizeCode("x".repeat(500)), null);
  assert.equal(normalizeCode(123 as unknown as string), null);
});

test("hashes are keyed, stable and never equal the code", () => {
  const code = generateCode();
  const h = hashCode(code, keys);
  assert.equal(h, hashCode(code, keys));
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.ok(!h.includes(code));
  const otherKeys = deriveHashKeys("a-different-secret-0123456789abcdef");
  assert.notEqual(h, hashCode(code, otherKeys));
  assert.notEqual(hashIp("203.0.113.9", keys), hashIp("203.0.113.9", otherKeys));
  assert.equal(hashIp(undefined, keys), hashIp("", keys));
});

test("device tokens are 32 random bytes and stored only as a hash", () => {
  const t = generateDeviceToken();
  assert.ok(isDeviceTokenShape(t));
  assert.notEqual(t, generateDeviceToken());
  assert.equal(Buffer.from(t, "base64url").length, 32);
  assert.match(hashDeviceToken(t), /^[0-9a-f]{64}$/);
  assert.ok(!isDeviceTokenShape("short"));
  assert.ok(!isDeviceTokenShape(undefined));
});

test("every outcome has a plain message (NFR-06)", () => {
  for (const o of CODE_OUTCOMES) {
    const m = codeMessage(o);
    if (o === "ok") assert.equal(m, null);
    else assert.ok(m && m.length > 10 && !/error|exception|null|undefined|sql/i.test(m), `${o}: ${m}`);
  }
  for (const o of GENERATE_OUTCOMES) {
    const m = generateMessage(o);
    if (o === "ok") assert.equal(m, null);
    else assert.ok(m && m.length > 10 && !/error|exception|null|undefined|sql/i.test(m), `${o}: ${m}`);
  }
});
