export async function getVariantsWithB2BPrices(admin) {
  const variantIds = new Set();
  let hasNextPage = true;
  let after = null;

  while (hasNextPage) {
    const response = await admin.graphql(
      `#graphql
      query getB2BVariantUsage($after: String) {
        productVariants(first: 250, after: $after) {
          pageInfo {
            hasNextPage
            endCursor
          }
          edges {
            node {
              id
              metafield(namespace: "$app", key: "gd_b2b_price") {
                value
              }
              groupPriceMetafield: metafield(namespace: "$app", key: "gd_b2b_group_prices") {
                value
              }
            }
          }
        }
      }`,
      { variables: { after } }
    );

    const json = await response.json();
    const connection = json.data?.productVariants;

    connection?.edges?.forEach(({ node }) => {
      const value = node.metafield?.value;
      if (value !== undefined && value !== null && parseFloat(value) > 0) {
        variantIds.add(node.id);
      }

      const groupPriceValue = node.groupPriceMetafield?.value;
      if (groupPriceValue) {
        try {
          const groupPrices = JSON.parse(groupPriceValue);
          if (Object.values(groupPrices).some((price) => Number(price) > 0)) {
            variantIds.add(node.id);
          }
        } catch {
          // Ignore malformed legacy data for usage counts.
        }
      }
    });

    hasNextPage = Boolean(connection?.pageInfo?.hasNextPage);
    after = connection?.pageInfo?.endCursor || null;
  }

  return variantIds;
}
