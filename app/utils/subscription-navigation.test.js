/* eslint-env node */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getPricingPlansUrl } from './app-pricing.server.js';

test('live-store plan gating renders an in-app selection screen without automatic navigation', () => {
  const source = readFileSync(new URL('../routes/app.jsx', import.meta.url), 'utf8');
  assert.match(source, /admin, session.*authenticate\.admin\(request\)/);
  assert.match(source, /hasActiveSubscription \? <Outlet \/> : <PlanSelection \/>/);
  assert.doesNotMatch(source, /return redirect\(pricingPlansUrl/);
  assert.doesNotMatch(source, /navigate\("\/app\/subscription"\)/);
});

test('plan selection uses an explicit top-level button and supports refreshing billing status', () => {
  const source = readFileSync(new URL('../components/plan-selection.jsx', import.meta.url), 'utf8');
  assert.match(source, /href=\{pricingPlansUrl\} target="_top">Select your plan/);
  assert.match(source, /revalidator\.revalidate\(\)/);
  const subscription = readFileSync(new URL('../routes/app.subscription.jsx', import.meta.url), 'utf8');
  assert.doesNotMatch(subscription, /return redirect\(manageUrl/);
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
