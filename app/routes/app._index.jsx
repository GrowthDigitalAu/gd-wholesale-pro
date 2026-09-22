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
            <h2>Go beyond Shopify&apos;s default B2B catalogs.</h2>
            <p className="panel-copy">Create buyer groups, approve trade accounts, and set exact variant prices for each wholesale tier from one workflow.</p>
          </div>
        </div>

        <s-section heading="Built for real wholesale price lists">
          <div className="import-guide-grid value-grid">
            <div>
              <h3>Group-specific variant prices</h3>
              <p className="panel-copy">Set a different fixed price for the same SKU across Wholesale, Distributor, VIP, Gold, Trade, or any approved buyer group.</p>
            </div>
            <div>
              <h3>Approvals tied to pricing</h3>
              <p className="panel-copy">Approve applications into the right group so buyers receive B2B_approved plus the correct pricing tag automatically.</p>
            </div>
            <div>
              <h3>Storefront and checkout sync</h3>
              <p className="panel-copy">Show the right buyer price on product pages and apply the matching discount at checkout with minimum order controls.</p>
            </div>
          </div>
        </s-section>

        <s-box paddingBlockStart="large" />

        <div className="action-grid three-columns">
          <s-section heading="Wholesale applications">
            <div className="action-panel">
              <p className="panel-copy">Review incoming buyer applications, approve accounts, and apply the wholesale customer tag.</p>
              <s-link href="/app/forms">Open applications</s-link>
            </div>
          </s-section>
          <s-section heading="Wholesale groups">
            <div className="action-panel">
              <p className="panel-copy">Create buyer tiers such as Gold, Distributor, or VIP using Shopify customer tags and dedicated price lists.</p>
              <s-link href="/app/groups">Open groups</s-link>
            </div>
          </s-section>
          <s-section heading="Wholesale pricing">
            <div className="action-panel">
              <p className="panel-copy">Set default B2B prices or choose a group and enter exact variant prices for that buyer tier.</p>
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
