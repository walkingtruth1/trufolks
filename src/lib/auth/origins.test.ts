import { test } from "node:test";
import assert from "node:assert/strict";
import { LOCAL_DEV_ORIGINS, missingDeploySecret, resolveAuthOrigins } from "./origins.ts";

test("local dev trusts loopback only", () => {
  const r = resolveAuthOrigins({});
  assert.deepEqual(r.trustedOrigins, LOCAL_DEV_ORIGINS);
  assert.equal(typeof r.baseURL, "object");
});

test("production uses BETTER_AUTH_URL only", () => {
  const r = resolveAuthOrigins({
    VERCEL_ENV: "production",
    VERCEL_URL: "trufolks-abc.vercel.app",
    BETTER_AUTH_URL: "https://trufolks.com",
  });
  assert.equal(r.baseURL, "https://trufolks.com");
  assert.deepEqual(r.trustedOrigins, ["https://trufolks.com"]);
});

test("preview trusts its deployment URL and branch URL, never a wildcard", () => {
  const r = resolveAuthOrigins({
    VERCEL_ENV: "preview",
    VERCEL_URL: "trufolks-ax045s8xq-juice-7e54.vercel.app",
    VERCEL_BRANCH_URL: "trufolks-git-feat-foundation-v16-juice-7e54.vercel.app",
  });
  assert.deepEqual(r.trustedOrigins, [
    "https://trufolks-git-feat-foundation-v16-juice-7e54.vercel.app",
    "https://trufolks-ax045s8xq-juice-7e54.vercel.app",
  ]);
  assert.ok(typeof r.baseURL === "object");
  assert.equal(r.baseURL.protocol, "https");
  assert.ok(!r.baseURL.allowedHosts.some((h) => h.includes("*")));
});

test("preview also keeps an explicit BETTER_AUTH_URL host, deduplicated", () => {
  const r = resolveAuthOrigins({
    VERCEL_ENV: "preview",
    VERCEL_URL: "a.vercel.app",
    BETTER_AUTH_URL: "https://a.vercel.app/",
  });
  assert.deepEqual(r.trustedOrigins, ["https://a.vercel.app"]);
});

test("a deployed server needs BETTER_AUTH_SECRET; local dev does not", () => {
  assert.equal(missingDeploySecret({ VERCEL: "1" }), true);
  assert.equal(missingDeploySecret({ VERCEL: "1", BETTER_AUTH_SECRET: " " }), true);
  assert.equal(missingDeploySecret({ VERCEL: "1", BETTER_AUTH_SECRET: "x" }), false);
  assert.equal(missingDeploySecret({}), false);
});
