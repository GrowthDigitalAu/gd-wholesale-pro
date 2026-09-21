# GD: Wholesale Pro

GD: Wholesale Pro is a Shopify app for merchants who need wholesale workflows beyond the native three-catalog B2B baseline available on non-Plus plans.

The app currently provides:

- Wholesale buyer application forms with approval and rejection workflows.
- Automatic tagging of approved buyers with `B2B_approved`.
- Variant-level wholesale prices stored in app-owned metafields.
- Minimum quantity rules for wholesale-priced variants.
- A Shopify Function that applies wholesale pricing at checkout.
- Excel import and export for retail prices, compare-at prices, minimum quantities, and B2B prices.
- Theme app blocks for storefront wholesale price display, buyer application forms, and cart handling.

## Shopify B2B Context

As of April 2026, Shopify includes foundational B2B features on Basic, Grow, and Advanced plans, including companies, payment terms, quantity rules, volume pricing, and up to three active B2B catalogs assigned through Markets.

GD: Wholesale Pro should focus on the workflows that native Shopify does not fully cover for growing merchants:

- More flexible pricing workflows than three broad catalogs.
- Easier spreadsheet-driven price management.
- Buyer application collection and approval.
- Storefront access control and buyer-specific experiences.
- Future buyer portals, quick ordering, and wholesale analytics.

## Local Development

Install dependencies:

```shell
npm install
```

Generate Prisma client and apply migrations:

```shell
npm run setup
```

Start Shopify app development:

```shell
npm run dev
```

## Deployment

This project is hosted with Dokploy. Pushing to the connected GitHub repository updates the live app through the Dokploy deployment pipeline.

Before pushing production changes, run:

```shell
npm run typecheck
npm run build
```

## Key Files

- `app/routes/app.b2b-pricing.jsx` - wholesale pricing editor.
- `app/routes/app.import-product-prices.jsx` - Excel import workflow.
- `app/routes/app.export-product-prices.jsx` - Excel export workflow.
- `app/routes/app.forms._index.jsx` - wholesale application submissions.
- `app/routes/app.forms.$id.jsx` - wholesale application form builder.
- `extensions/gd-b2b-discount/src/run.js` - checkout discount logic.
- `extensions/b2b-price/blocks` - storefront theme app blocks.

## Compatibility Notes

Some internal metafield namespaces still use the original `gd_price_updator` naming for compatibility with installed storefront blocks. Rename these only through a planned migration.
