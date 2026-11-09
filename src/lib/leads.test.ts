import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { readLeads, saveLead, type Lead } from "./leads.ts";

const shopper: Lead = {
  role: "shopper",
  name: "Example Shopper",
  email: "shopper@example.test",
  detail: "Product",
  extra: "",
  at: "2025-01-01T00:00:00.000Z",
};
const brand: Lead = { ...shopper, role: "brand", extra: "Campaign" };

function mockStorage(t: TestContext, raw: string | null, failRead = false) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const writes: string[] = [];
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem(key: string) {
        assert.equal(key, "trufolks.leads");
        if (failRead) throw new Error("Storage unavailable");
        return raw;
      },
      setItem(key: string, value: string) {
        assert.equal(key, "trufolks.leads");
        writes.push(value);
      },
    },
  });
  t.after(() => {
    if (descriptor) {
      Object.defineProperty(globalThis, "localStorage", descriptor);
    } else {
      Reflect.deleteProperty(globalThis, "localStorage");
    }
  });
  return writes;
}

test("readLeads keeps valid records in order without rewriting storage", (t) => {
  const writes = mockStorage(t, JSON.stringify([
    null,
    shopper,
    ["shopper"],
    1,
    "bad",
    { ...shopper, role: "other" },
    { ...shopper, name: 123 },
    { ...shopper, email: false },
    { ...shopper, detail: null },
    { ...shopper, extra: undefined },
    { ...shopper, at: undefined },
    brand,
  ]));
  assert.deepEqual(readLeads(), [shopper, brand]);
  assert.deepEqual(writes, []);
});

test("readLeads falls back to an empty list for unusable storage", async (t) => {
  for (const [label, raw, failRead] of [
    ["absent value", null, false],
    ["invalid JSON", "{", false],
    ["non-array JSON", "{}", false],
    ["storage access error", null, true],
  ] as const) {
    await t.test(label, (child) => {
      const writes = mockStorage(child, raw, failRead);
      assert.deepEqual(readLeads(), []);
      assert.deepEqual(writes, []);
    });
  }
});

test("saveLead appends a timestamped record and omits corrupt prior rows", (t) => {
  const writes = mockStorage(t, JSON.stringify([null, shopper, {}, brand]));
  const lead = {
    role: "brand",
    name: "Another Brand",
    email: "another@example.test",
    detail: "Another Product",
    extra: "",
  } as const;
  const saved = saveLead(lead);
  assert.deepEqual(saved, { ...lead, at: new Date(saved.at).toISOString() });
  assert.deepEqual(writes, [JSON.stringify([shopper, brand, saved])]);
});
