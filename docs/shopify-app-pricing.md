# Shopify App Pricing deployment

The app uses Partner API subscription reads when configured. With all Partner
variables absent, existing Billing API reads remain available during migration.
Partial configuration or API failures stop verification; they never silently
grant access or trigger a downgrade.

A successful Partner API response with no contract also checks existing active,
non-test Billing API subscriptions, so existing live merchants need not approve
a second subscription. API errors do not trigger this compatibility lookup.

Shopify's shop.plan.partnerDevelopment flag grants free development preview
with unlimited groups and variants, without selecting an app plan. The flag is
checked on every billing read. Once it becomes false, preview access ends and
the merchant needs a verified live subscription. Trial duration is configured
in Shopify's Partner Dashboard, not started or reset by this app.
Store ownership transfer alone is not used as a billing signal; Shopify must
stop identifying the store as a development store.
If no live subscription exists, saved pricing and groups are preserved while
the merchant selects a plan. Selecting a lower plan applies the downgrade policy.

## Dokploy environment

- SHOPIFY_PARTNER_ORG_ID: numeric organization ID from your Partner Dashboard URL.
- SHOPIFY_PARTNER_API_ACCESS_TOKEN: secret Partner API client token with Manage apps permission.
- SHOPIFY_PARTNER_APP_ID: numeric app ID or gid://shopify/App/ID. This is not the OAuth client ID.
- SHOPIFY_PARTNER_API_VERSION: 2026-07 (default).
- SHOPIFY_APP_PRICING_PLAN_HANDLES: optional JSON mapping of pricing item handles to Free, Startup, Growth, or Expand. Example: {"startup_monthly":"Startup","growth_yearly":"Growth"}.
- SHOPIFY_APP_PRICING_HANDLE: the app listing handle in the hosted pricing URL. Defaults to the existing gd-priceupdator-pro handle; verify it belongs to Wholesale Pro before activation.

Create the client under Partner Dashboard > Settings > Partner API clients.
Keep the token only in Dokploy environment secrets. Redeploy after setting it.
Plan identity comes from handles/descriptions, never the amount charged: paid
plans on development stores may cost $0.

## Partner Dashboard

Enable Shopify App Pricing and configure the existing Free, Startup, Growth,
and Expand plans. Set each welcome link to /app. Shopify appends
plan_handle; the app verifies the plan with the API rather than trusting the URL.
For live stores, the Subscription menu and /app/subscription open Shopify's
hosted pricing page. Existing welcome links to /app/subscription containing
plan_handle return verified subscribers to /app to avoid a pricing-page loop.
Verify the hosted pricing URL uses this app's actual listing handle.
Migration of existing contracts must be completed in the Partner Dashboard or
Shopify CLI; deploying this code does not migrate contracts.

## Verify on a development store

Select each plan and check its group and variant limits. Test monthly/yearly,
trial and $0 test subscriptions, a scheduled change, cancellation, and a change
made from Shopify admin outside the app. Reopen the app after each change.
An API outage must not remove prices or pause groups.
When a verified plan changes, the existing downgrade policy applies: extra
groups are paused and the oldest excess variant prices are removed. This now
checks the full catalog, including stores with more than 250 variants.

References:
- https://shopify.dev/docs/apps/launch/billing/shopify-app-pricing
- https://shopify.dev/docs/api/partner/latest/active-subscription
- https://shopify.dev/docs/api/partner/latest
