# Wholesale Quick Order release checks

This is a theme app extension block, not an admin bulk-order screen.

Quick-order JavaScript source is in `scripts/b2b-quick-order.js`. Run
`npm run build:quick-order` after editing it and before Shopify deployment.
The generated asset is committed to keep direct CLI deployment reproducible.

## Publish and activate

1. Run Shopify CLI theme checks and `shopify app deploy` from the app directory.
2. Confirm the new app version includes the Wholesale Quick Order block.
3. Create an Online Store page and a page template supporting app blocks.
4. Add Wholesale Quick Order in the Theme Editor and choose a collection.
5. Assign the template to the page and add the page to navigation.
6. Confirm the existing app embed and wholesale discount function are active.

GitHub/Dokploy deployment updates the backend and setup guide only. It does not
publish the theme extension to Shopify.

## Test before release

- Signed-out and unapproved buyers cannot see the quick-order price list.
- Approved Gold and Distributor buyers see their respective group estimates.
- Multiple matching group tags follow the published group-rule order.
- Percentage groups, default fallback and prices above retail match checkout.
- Below-minimum, fractional and negative quantities are rejected before add.
- Sold-out variants are disabled; Shopify rejects inventory conflicts.
- Multi-variant add uses the locale-aware cart endpoint.
- Filtering retains quantities for hidden rows; totals include those selections.
- Cart errors retain quantities and tell buyers to check their cart before retry.
- Button disables while adding, preventing duplicate concurrent submissions.
- Mobile table scrolls and keyboard focus/labels work.
- Verify collection loading, case-insensitive search and retained quantities
  across the client-side variant pages. Test retry after a catalog-loading error.
- Fixed-price estimates are used only in base currency; verify other markets in
  cart/checkout before claiming market-specific wholesale support.
- Verify cart opt-out, group order thresholds, tax and discount stacking.

No changes to the existing checkout pricing engine were made for this feature.

## Saved lists, reorder and audit-history upgrade

- Deploy the new Prisma migration through `npm run setup` before serving the
  updated backend. This creates SavedOrderList and PricingAudit tables.
- Publish the theme extension and updated `write_app_proxy` scope with Shopify
  CLI. Existing stores may need to approve the additional permission.
- If Dokploy sets `SCOPES`, add `write_app_proxy` there too, preserving the
  existing scopes; the backend uses that environment value for OAuth.
- App proxy must point to `/api`; its default storefront base is `/apps/proxy`.
  If a merchant customised it, update the block's saved-list proxy path.
- Lists are durable per shop/customer, with 20 lists of 100 variants each. They
  store identifiers and quantities only, never historical prices.
- Reorder supports the most recent 10 paid orders available under `read_orders`
  (normally 60 days). Orders over 100 lines are explicitly not loaded.
- Test saved-list create, named overwrite, delete, cross-device access and
  ownership isolation. Confirm expired/unapproved sessions cannot read lists.
- Test repeat ordering when variants were removed/sold out or minimums changed.
- Search traverses the configured collection using Shopify Liquid pagination.
  Shopify's 25,000-product and Liquid variant iteration limits still apply.
  Very large/high-variant catalogs require a future server-indexed search path.
- History captures manual default/group price and minimum edits and bulk price
  import intents. It records applied/failed/unknown outcomes without claiming
  success for uncertain network or bulk results. Actor is the authenticated
  Shopify user ID when available; otherwise the shared admin session is labelled.
- History starts with this release, has no rollback, and excludes external edits,
  wholesale group rule changes and automatic subscription-limit cleanup.
- Import outcomes refresh on the import screen and the Pricing History page.
  Submission interrupted before an operation ID is linked requires manual review.
- Customer redaction deletes saved lists. Shop redaction and uninstall delete
  saved lists and new audit records. Existing unrelated data policies are unchanged.
- Customer data requests still need operator handling: monitor compliance webhook
  events and use `/app/saved-order-lists` with the verified customer ID to export
  their stored list data. Deliver it using your established secure support process.
- Run database-backed ownership/quota/migration tests on staging, then test the
  published block on desktop/mobile and both supported customer-account modes.
