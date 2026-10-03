# Wholesale Quick Order release checks

This is a theme app extension block, not an admin bulk-order screen.

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
- Verify 20-product pagination and add each page's selection before navigating.
- Fixed-price estimates are used only in base currency; verify other markets in
  cart/checkout before claiming market-specific wholesale support.
- Verify cart opt-out, group order thresholds, tax and discount stacking.

No changes to the existing checkout pricing engine were made for this feature.
