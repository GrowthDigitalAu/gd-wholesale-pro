import { authenticate } from "../shopify.server";
// import { json } from "@remix-run/node"; // Not needed in newer RR7 setups if returning objects directly works, or use Response.json()

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);

  // 1. Define the Metafield Definition
  const definition = {
    name: "Original Price (B2B)",
    namespace: "app",
    key: "gd_b2b_price",
    description: "Original price of the product for B2B calculations.",
    type: "number_decimal",
    ownerType: "PRODUCTVARIANT",
    access: {
      admin: "MERCHANT_READ", // This makes it Read-Only for the Merchant in Admin
      storefront: "PUBLIC_READ" // Optional: Allow storefront to read it easily
    }
  };

  // 2. Check if it exists
  const checkQuery = await admin.graphql(
    `#graphql
    query getDefinition($namespace: String!, $key: String!) {
      metafieldDefinitions(first: 1, namespace: $namespace, key: $key, ownerType: PRODUCTVARIANT) {
        edges {
          node {
            id
            access {
              admin
            }
          }
        }
      }
    }`,
    { variables: { namespace: definition.namespace, key: definition.key } }
  );
  
  const checkJson = await checkQuery.json();
  const existingId = checkJson.data?.metafieldDefinitions?.edges?.[0]?.node?.id;

  let result;
  
  if (existingId) {
    // 3. Update existing
    const response = await admin.graphql(
      `#graphql
      mutation UpdateMetafieldDefinition($definition: MetafieldDefinitionUpdateInput!) {
        metafieldDefinitionUpdate(definition: $definition) {
          updatedDefinition {
            id
            access { admin }
          }
          userErrors {
            field
            message
          }
        }
      }`,
      {
        variables: {
          definition: {
            id: existingId,
            access: definition.access
          }
        }
      }
    );
    result = await response.json();
  } else {
    // 4. Create new
    const response = await admin.graphql(
      `#graphql
      mutation CreateMetafieldDefinition($definition: MetafieldDefinitionInput!) {
        metafieldDefinitionCreate(definition: $definition) {
          createdDefinition {
            id
            access { admin }
          }
          userErrors {
            field
            message
          }
        }
      }`,
      {
        variables: {
          definition
        }
      }
    );
    result = await response.json();
  }

  // Return standard Response object or plain object (RR7 supports plain objects)
  return { 
    message: existingId ? "Metafield Definition Updated" : "Metafield Definition Created",
    details: result
  };
};
