/* eslint-env node */
/* global globalThis */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  getAppSubscription,
  normalizeSubscription,
} from "./app-pricing.server.js";

test("free contracts and $0 test prices retain plan identity", () => {
  assert.equal(normalizeSubscription(null), null);
  assert.equal(
    normalizeSubscription({
      items: [
        {
          handle: "growth_yearly",
          description: "Growth",
          price: { active: true, amount: "0" },
        },
      ],
    }).name,
    "Growth",
  );
  assert.equal(
    normalizeSubscription(
      { items: [{ handle: "custom", price: { active: true } }] },
      { custom: "Expand" },
    ).name,
    "Expand",
  );
  assert.throws(() =>
    normalizeSubscription({
      items: [{ handle: "unknown", price: { active: true } }],
    }),
  );
});

test("scheduled changes retain current plan until effective", () => {
  const subscription = normalizeSubscription({
    items: [{ handle: "growth", price: { active: true } }],
    pendingUpdate: { items: [{ handle: "free" }] },
    cancelAtEndOfCycle: true,
  });
  assert.equal(subscription.name, "growth");
  assert.equal(subscription.status, "ACTIVE");
  assert.equal(subscription.cancelAtEndOfCycle, true);
});

test("configured Partner API null is authoritative and failures never fall back", async () => {
  const originalFetch = globalThis.fetch;
  const keys = [
    "SHOPIFY_PARTNER_ORG_ID",
    "SHOPIFY_PARTNER_API_ACCESS_TOKEN",
    "SHOPIFY_PARTNER_APP_ID",
    "SHOPIFY_APP_PRICING_PLAN_HANDLES",
  ];
  const originals = keys.map((key) => process.env[key]);
  Object.assign(process.env, {
    SHOPIFY_PARTNER_ORG_ID: "123",
    SHOPIFY_PARTNER_API_ACCESS_TOKEN: "test-token",
    SHOPIFY_PARTNER_APP_ID: "456",
    SHOPIFY_APP_PRICING_PLAN_HANDLES: "{}",
  });
  const admin = {
    graphql: async (query) => {
      assert.ok(!query.includes("currentAppInstallation"));
      return {
        json: async () => ({
          data: { shop: { id: "gid://shopify/Shop/789" } },
        }),
      };
    },
  };
  try {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({ data: { activeSubscription: null } }),
    });
    assert.deepEqual(await getAppSubscription({ admin }), []);
    globalThis.fetch = async () => ({ ok: false, status: 503 });
    await assert.rejects(getAppSubscription({ admin }));
  } finally {
    globalThis.fetch = originalFetch;
    keys.forEach((key, index) => {
      if (originals[index] === undefined) delete process.env[key];
      else process.env[key] = originals[index];
    });
  }
});
