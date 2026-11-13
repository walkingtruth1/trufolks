// Ticket 3b-1 — EXIF "taken at" reader, image sniffing, admin allowlist,
// safe return path and the review flags. Pure, no database.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseExifDateTime, readExifTakenAt, sniffImageType } from "./exif.ts";
import { isAdmin, parseAdminUserIds } from "./admin.ts";
import { computeChecks, type CheckInput } from "./photos.ts";
import { safeNextPath } from "../auth/safe-next.ts";
import { jpegWithExif } from "./test-support.ts";

test("reads the taken-at time in both byte orders, applying the time-zone offset", () => {
  for (const little of [true, false]) {
    const r = readExifTakenAt(jpegWithExif({ little, when: "2026:11:11 08:30:00", offset: "-05:00" }));
    assert.ok(r);
    assert.equal(r.takenAt.toISOString(), "2026-11-11T13:30:00.000Z");
    assert.equal(r.hasOffset, true);
  }
});

test("without an offset the time is read as UTC and flagged as zone-unknown", () => {
  const r = readExifTakenAt(jpegWithExif({ little: true, when: "2026:11:11 08:30:00" }));
  assert.ok(r);
  assert.equal(r.takenAt.toISOString(), "2026-11-11T08:30:00.000Z");
  assert.equal(r.hasOffset, false);
});

test("impossible dates, missing EXIF and non-JPEGs give null", () => {
  assert.equal(readExifTakenAt(jpegWithExif({ little: true, when: "2026:02:31 08:30:00" })), null);
  assert.equal(readExifTakenAt(jpegWithExif({ little: true, when: "1999:01:01 00:00:00" })), null);
  assert.equal(readExifTakenAt(jpegWithExif({ little: true, when: "not a date at all!!" })), null);
  assert.equal(readExifTakenAt(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 2, 0xff, 0xd9])), null);
  assert.equal(readExifTakenAt(new Uint8Array([0x89, 0x50, 0x4e, 0x47])), null);
  assert.equal(readExifTakenAt(new Uint8Array()), null);
  assert.equal(parseExifDateTime("2026:11:11 08:30:00", "+15:00"), null);
});

test("cut-off and random files never throw", () => {
  const full = jpegWithExif({ little: false, when: "2026:11:11 08:30:00", offset: "+01:00" });
  for (let n = 0; n < full.length; n += 1) {
    const r = readExifTakenAt(full.subarray(0, n));
    assert.ok(r === null || r.takenAt instanceof Date);
  }
  for (let i = 0; i < 500; i += 1) {
    const junk = new Uint8Array(64 + (i % 200));
    for (let j = 0; j < junk.length; j += 1) junk[j] = Math.floor(Math.random() * 256);
    junk[0] = 0xff;
    junk[1] = 0xd8;
    assert.doesNotThrow(() => readExifTakenAt(junk));
  }
});

test("image type comes from the bytes, not the file name", () => {
  assert.equal(sniffImageType(jpegWithExif({ little: true, when: "2026:11:11 08:30:00" })), "image/jpeg");
  assert.equal(sniffImageType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), "image/png");
  assert.equal(
    sniffImageType(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])),
    "image/webp",
  );
  assert.equal(sniffImageType(new TextEncoder().encode("<svg onload=alert(1)>")), null);
  assert.equal(sniffImageType(new TextEncoder().encode("%PDF-1.7")), null);
});

test("admin allowlist: ids only, blanks and the dev user ignored", () => {
  assert.deepEqual([...parseAdminUserIds(" a1 , ,b2,dev-user")], ["a1", "b2"]);
  assert.equal(isAdmin("a1", "a1,b2"), true);
  assert.equal(isAdmin("c3", "a1,b2"), false);
  assert.equal(isAdmin("dev-user", "dev-user"), false);
  assert.equal(isAdmin("", "a1"), false);
  assert.equal(isAdmin("a1", undefined), false);
  assert.equal(isAdmin("a1", ""), false);
});

test("return-to path only allows this site", () => {
  assert.equal(safeNextPath("/r/ABCD1234EFGH5"), "/r/ABCD1234EFGH5");
  assert.equal(safeNextPath("/r/X?step=photo#top"), "/r/X?step=photo#top");
  for (const bad of [
    "//evil.com", "https://evil.com", "http:/evil.com", "javascript:alert(1)", "/\\evil.com",
    "\\\\evil.com", "/\tevil", "evil.com", "", "   ", "/" + "a".repeat(400), null, 42, undefined,
  ]) {
    assert.equal(safeNextPath(bad), "/profile", `should refuse ${String(bad)}`);
  }
  assert.equal(safeNextPath("//evil.com", "/"), "/");
});

function checkInput(over: Partial<CheckInput> = {}): CheckInput {
  return {
    hasPhoto: true,
    exifTakenAt: "2026-11-11T13:30:00.000Z",
    exifHasOffset: true,
    campaignStartsAt: "2026-11-10T00:00:00.000Z",
    campaignEndsAt: "2026-11-24T00:00:00.000Z",
    purchasedAt: "2026-11-11T13:25:00.000Z",
    claimsInCampaign: 1,
    issueMode: "till_single_purchase",
    ...over,
  };
}

const codes = (input: CheckInput) => computeChecks(input, 12 * 3600).map((c) => c.code);

test("review flags: a clean receipt raises none", () => {
  assert.deepEqual(codes(checkInput()), []);
});

test("review flags: each concern raises its own flag", () => {
  assert.deepEqual(codes(checkInput({ hasPhoto: false, exifTakenAt: null })), ["no_photo"]);
  assert.deepEqual(codes(checkInput({ exifTakenAt: null })), ["no_photo_time"]);
  assert.ok(codes(checkInput({ exifHasOffset: false })).includes("photo_time_zone_unknown"));
  assert.ok(codes(checkInput({ issueMode: "handout_batch" })).includes("handout_code"));
  const before = codes(checkInput({ exifTakenAt: "2026-11-01T00:00:00.000Z" }));
  assert.ok(before.includes("photo_outside_campaign") && before.includes("photo_time_differs"));
  assert.ok(codes(checkInput({ exifTakenAt: "2026-11-12T13:30:00.000Z" })).includes("photo_time_differs"));
  assert.ok(codes(checkInput({ claimsInCampaign: 3 })).includes("several_claims"));
  for (const c of computeChecks(checkInput({ hasPhoto: false, claimsInCampaign: 4 }), 3600)) {
    assert.ok(c.label.length > 10 && !/error|null|undefined/i.test(c.label));
  }
});
