import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);

  // 1. Check if Discount Already Exists
  const checkQuery = await admin.graphql(
    `#graphql
    query checkDiscount {
      discountNodes(first: 1, query: "title:'B2B Special Price'") {
        nodes {
          id
        }
      }
    }`
  );
  const checkJson = await checkQuery.json();
  const existingDiscounts = checkJson.data?.discountNodes?.nodes || [];

  if (existingDiscounts.length === 0) {
    console.log("Auto-Creating Discount...");

    // 2. Fetch Function ID
    const functionsQuery = await admin.graphql(
      `#graphql
          query {
              shopifyFunctions(first: 25) {
                  nodes {
                      id
                      apiType
                      title
                  }
              }
          }`
    );
    const functionsJson = await functionsQuery.json();
    const functionNode = functionsJson.data?.shopifyFunctions?.nodes?.find(
      node => node.title === "gd-b2b-discount" || node.apiType === "product_discounts"
    );

    if (functionNode) {
      // 3. Create Discount
      await admin.graphql(
        `#graphql
              mutation createB2bDiscount($functionId: String!) {
                  discountAutomaticAppCreate(
                      automaticAppDiscount: {
                          title: "B2B Special Price"
                          functionId: $functionId
                          discountClasses: [PRODUCT]
                          startsAt: "2025-12-17T00:00:00Z"
                      }
                  ) {
                      automaticAppDiscount {
                          discountId
                      }
                      userErrors {
                          field
                          message
                      }
                  }
              }`,
        {
          variables: {
            functionId: functionNode.id
          }
        }
      );
      console.log("Discount Created.");
    } else {
      console.log("Function not found.");
    }
  }

  return null;
};

export default function Index() {
  return (
    <s-page heading="GD: Wholesale Pro" inlineSize="large">
      <div className="page-frame">
        <div className="dashboard-hero">
          <div>
            <h2>Run wholesale pricing and buyer approvals from one place.</h2>
            <p className="panel-copy">Approve trade buyers, set fixed wholesale prices and minimum quantities, then manage larger catalog updates through Excel.</p>
          </div>
        </div>

        <div className="action-grid three-columns">
          <s-section heading="Wholesale applications">
            <div className="action-panel">
              <p className="panel-copy">Review incoming buyer applications, approve accounts, and apply the wholesale customer tag.</p>
              <s-link href="/app/forms">Open applications</s-link>
            </div>
          </s-section>
          <s-section heading="Wholesale groups">
            <div className="action-panel">
              <p className="panel-copy">Create buyer tiers such as Gold, Distributor, or VIP using Shopify customer tags.</p>
              <s-link href="/app/groups">Open groups</s-link>
            </div>
          </s-section>
          <s-section heading="Wholesale pricing">
            <div className="action-panel">
              <p className="panel-copy">Set B2B prices and minimum order quantities directly on Shopify variants.</p>
              <s-link href="/app/b2b-pricing">Open pricing</s-link>
            </div>
          </s-section>
          <s-section heading="Bulk price files">
            <div className="action-panel">
              <p className="panel-copy">Import or export retail, compare-at, minimum quantity, and B2B price data using Excel.</p>
              <s-link href="/app/import-product-prices">Open import</s-link>
            </div>
          </s-section>
        </div>
      </div>
    </s-page>
  );
}
