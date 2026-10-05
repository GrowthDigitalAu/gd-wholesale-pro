/* eslint-env node */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getPricingPlansUrl } from './app-pricing.server.js';

test('live-store plan gating uses authenticated top-level redirect, not a contextless client navigation', () => {
  const source = readFileSync(new URL('../routes/app.jsx', import.meta.url), 'utf8');
  assert.match(source, /admin, session, redirect.*authenticate\.admin\(request\)/);
  assert.match(source, /if \(!hasActiveSubscription\) return redirect\(pricingPlansUrl, \{ target: "_top" \}\)/);
  assert.doesNotMatch(source, /navigate\("\/app\/subscription"\)/);
});

test('subscription route preserves Shopify authentication error boundaries and headers', () => {
  const source = readFileSync(new URL('../routes/app.subscription.jsx', import.meta.url), 'utf8');
  assert.match(source, /boundary\.error\(useRouteError\(\)\)/);
  assert.match(source, /boundary\.headers\(headersArgs\)/);
});

test('pricing destination uses the live store and configured app handle', () => {
  const previous = process.env.SHOPIFY_APP_PRICING_HANDLE;
  try {
    process.env.SHOPIFY_APP_PRICING_HANDLE = 'gd-wholesale-pro';
    assert.equal(getPricingPlansUrl('uniform-link.myshopify.com'), 'https://admin.shopify.com/store/uniform-link/charges/gd-wholesale-pro/pricing_plans');
  } finally {
    if (previous === undefined) delete process.env.SHOPIFY_APP_PRICING_HANDLE;
    else process.env.SHOPIFY_APP_PRICING_HANDLE = previous;
  }
});

test('missing and blank pricing overrides use the published Wholesale Pro handle', () => {
  const previous = process.env.SHOPIFY_APP_PRICING_HANDLE;
  try {
    for (const value of [undefined, '', '   ']) {
      if (value === undefined) delete process.env.SHOPIFY_APP_PRICING_HANDLE;
      else process.env.SHOPIFY_APP_PRICING_HANDLE = value;
      assert.equal(getPricingPlansUrl('uniform-link.myshopify.com'), 'https://admin.shopify.com/store/uniform-link/charges/gd-wholesale-pro/pricing_plans');
    }
  } finally {
    if (previous === undefined) delete process.env.SHOPIFY_APP_PRICING_HANDLE;
    else process.env.SHOPIFY_APP_PRICING_HANDLE = previous;
  }
});
