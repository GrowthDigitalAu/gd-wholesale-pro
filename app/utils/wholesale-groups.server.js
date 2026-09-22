export const WHOLESALE_GROUPS_NAMESPACE = "gd_wholesale_pro";
export const WHOLESALE_GROUP_RULES_KEY = "group_rules";

export async function syncWholesaleGroupRules({ admin, shop, db }) {
  const groups = await db.wholesaleGroup.findMany({
    where: {
      shop,
      isActive: true,
    },
    orderBy: { name: "asc" },
  });

  const shopResponse = await admin.graphql(
    `#graphql
    query {
      shop {
        id
      }
    }`
  );
  const shopJson = await shopResponse.json();
  const shopId = shopJson.data?.shop?.id;

  if (!shopId) {
    throw new Error("Unable to find Shopify shop ID.");
  }

  const rules = groups.map((group) => ({
    id: group.id,
    name: group.name,
    customerTag: group.customerTag,
    pricingMethod: group.pricingMethod,
    discountValue: group.discountValue,
    minimumOrder: group.minimumOrder,
  }));

  const response = await admin.graphql(
    `#graphql
    mutation MetafieldsSet($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields {
          id
          namespace
          key
        }
        userErrors {
          field
          message
        }
      }
    }`,
    {
      variables: {
        metafields: [
          {
            ownerId: shopId,
            namespace: WHOLESALE_GROUPS_NAMESPACE,
            key: WHOLESALE_GROUP_RULES_KEY,
            type: "json",
            value: JSON.stringify({ version: 1, groups: rules }),
          },
        ],
      },
    }
  );

  const json = await response.json();
  const errors = json.data?.metafieldsSet?.userErrors || [];

  if (errors.length > 0) {
    throw new Error(errors[0].message);
  }

  return rules;
}
