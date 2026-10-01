/* eslint-env node */
/* global globalThis */
import assert from "node:assert/strict";
import { test } from "node:test";
import { getVariantLimitForPlan, getGroupLimitForPlan } from "./subscription.js";
import {
  getAppSubscription,
  normalizeSubscription,
  describePartnerFailure,
} from "./app-pricing.server.js";

test("development preview has unlimited groups and variants, including VIP stores", () => {
  assert.equal(getVariantLimitForPlan("Development preview", "app-development-test-2.myshopify.com"), null);
  assert.equal(getGroupLimitForPlan("Development preview"), null);
  assert.equal(getVariantLimitForPlan("Startup", "live.myshopify.com"), 100);
  assert.equal(getGroupLimitForPlan("Startup"), 3);
});

test("HTTP diagnostics preserve Shopify errors and request ID without tokens", async () => {
  const message = await describePartnerFailure({ status: 401,
    headers: { get: () => "abc-123" },
    json: async () => ({ errors: "Invalid API client test-token shpat_secret123" }),
  }, "test-token");
  assert.match(message, /401.*Invalid API client/);
  assert.match(message, /abc-123/);
  assert.ok(!message.includes("test-token"));
  assert.ok(!message.includes("shpat_secret123"));
});

test("non-JSON upstream pages are never logged", async () => {
  const message = await describePartnerFailure({ status: 401, json: async () => { throw new Error("HTML page with private data"); } }, "test-token");
  assert.match(message, /No JSON error message/);
  assert.ok(!message.includes("private data"));
});

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
    "growth_yearly",
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

test("recognized handles work when the description is marketing text", () => {
  assert.equal(normalizeSubscription({ items: [{ handle: "startup_monthly", description: "Build your wholesale business", price: { active: true } }] }).name, "startup_monthly");
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

test("legacy subscriptions survive migration; API failures never fall back", async () => {
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
  let legacyCalls = 0;
  let development = false;
  let legacySubscriptions = [];
  const admin = {
    graphql: async (query) => {
      if (query.includes("currentAppInstallation")) {
        legacyCalls++;
        return { json: async () => ({ data: { currentAppInstallation: { activeSubscriptions: legacySubscriptions } } }) };
      }
      return {
        json: async () => ({
          data: { shop: { id: "gid://shopify/Shop/789", plan: { partnerDevelopment: development } } },
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
    assert.equal(legacyCalls, 1);
    legacySubscriptions = [{ id: "legacy", name: "Growth", status: "ACTIVE", test: false }];
    assert.equal((await getAppSubscription({ admin }))[0].id, "legacy");
    legacySubscriptions = [{ id: "test", name: "Growth", status: "ACTIVE", test: true }];
    assert.deepEqual(await getAppSubscription({ admin }), []);
    development = true;
    globalThis.fetch = async () => { throw new Error("Development stores must not call Partner billing"); };
    assert.equal((await getAppSubscription({ admin }))[0].source, "development");
    development = false;
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ data: { activeSubscription: null } }) });
    assert.deepEqual(await getAppSubscription({ admin }), []);
    const callsBeforeFailure = legacyCalls;
    globalThis.fetch = async () => ({ ok: false, status: 503 });
    await assert.rejects(getAppSubscription({ admin }));
    assert.equal(legacyCalls, callsBeforeFailure);
    process.env.SHOPIFY_PARTNER_ORG_ID = " 123 ";
    process.env.SHOPIFY_PARTNER_APP_ID = " 456 ";
    globalThis.fetch = async (url, options) => {
      assert.ok(url.includes("/123/api/"));
      assert.equal(JSON.parse(options.body).variables.appId, "gid://shopify/App/456");
      return { ok: true, json: async () => ({ errors: [{ message: "Access denied test-token" }] }) };
    };
    await assert.rejects(getAppSubscription({ admin }), (error) => error.message.includes("Access denied [redacted]") && !error.message.includes("test-token"));
  } finally {
    globalThis.fetch = originalFetch;
    keys.forEach((key, index) => {
      if (originals[index] === undefined) delete process.env[key];
      else process.env[key] = originals[index];
    });
  }
});
