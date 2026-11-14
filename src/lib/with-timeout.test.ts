import { test } from "node:test";
import assert from "node:assert/strict";
import { TimeoutError, withTimeout } from "./with-timeout.ts";

test("withTimeout passes a prompt answer through", async () => {
  assert.equal(await withTimeout(Promise.resolve(7), 50), 7);
});

test("withTimeout passes a prompt failure through", async () => {
  await assert.rejects(withTimeout(Promise.reject(new Error("boom")), 50), /boom/);
});

test("withTimeout rejects a request that never answers", async () => {
  await assert.rejects(withTimeout(new Promise<never>(() => {}), 20), TimeoutError);
});
