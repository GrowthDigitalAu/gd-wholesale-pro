import { useLoaderData, useSubmit, useNavigation, useActionData } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { syncWholesaleGroupRules } from "../utils/wholesale-groups.server";
import { getGroupLimitForPlan } from "../utils/subscription";

const normalizeTag = (value) => String(value || "").trim().replace(/\s+/g, "_");

export const loader = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);

  const billingCheck = await admin.graphql(
    `#graphql
    query {
      currentAppInstallation {
        activeSubscriptions {
          name
          status
        }
      }
    }`
  );
  const billingJson = await billingCheck.json();
  const activeSubscriptions = billingJson.data?.currentAppInstallation?.activeSubscriptions || [];
  const planName = activeSubscriptions[0]?.name || null;
  const groupLimit = getGroupLimitForPlan(planName);

  const groups = await db.wholesaleGroup.findMany({
    where: { shop: session.shop },
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
  });

  const shopResponse = await admin.graphql(
    `#graphql
    query {
      shop {
        metafield(namespace: "gd_wholesale_pro", key: "group_rules") {
          updatedAt
          value
        }
      }
    }`
  );
  const shopJson = await shopResponse.json();
  const rulesMetafield = shopJson.data?.shop?.metafield || null;

  return {
    groups,
    rulesMetafield,
    subscription: {
      planName: planName || "Free",
      groupLimit,
    },
  };
};

export const action = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");
  const id = formData.get("id") ? Number(formData.get("id")) : null;

  const billingCheck = await admin.graphql(
    `#graphql
    query {
      currentAppInstallation {
        activeSubscriptions {
          name
        }
      }
    }`
  );
  const billingJson = await billingCheck.json();
  const activeSubscriptions = billingJson.data?.currentAppInstallation?.activeSubscriptions || [];
  const planName = activeSubscriptions[0]?.name || null;
  const groupLimit = getGroupLimitForPlan(planName);

  if (intent === "delete" && id) {
    await db.wholesaleGroup.deleteMany({
      where: { id, shop: session.shop },
    });
    await syncWholesaleGroupRules({ admin, shop: session.shop, db });
    return { success: true, message: "Wholesale group deleted and rules synced." };
  }

  if (intent === "toggle" && id) {
    const group = await db.wholesaleGroup.findFirst({
      where: { id, shop: session.shop },
    });

    if (!group) return { error: "Wholesale group not found." };

    if (!group.isActive && groupLimit !== null) {
      const activeGroupCount = await db.wholesaleGroup.count({
        where: { shop: session.shop, isActive: true },
      });

      if (activeGroupCount >= groupLimit) {
        return { error: `Your ${planName || "Free"} plan includes ${groupLimit} active wholesale group${groupLimit === 1 ? "" : "s"}. Pause another group or upgrade your plan to activate this one.` };
      }
    }

    await db.wholesaleGroup.update({
      where: { id },
      data: { isActive: !group.isActive },
    });
    await syncWholesaleGroupRules({ admin, shop: session.shop, db });
    return { success: true, message: "Wholesale group status updated and rules synced." };
  }

  if (intent === "sync") {
    const rules = await syncWholesaleGroupRules({ admin, shop: session.shop, db });
    return { success: true, message: `${rules.length} active group rule(s) synced.` };
  }

  const name = String(formData.get("name") || "").trim();
  const customerTag = normalizeTag(formData.get("customerTag"));
  const description = String(formData.get("description") || "").trim();
  const pricingMethod = String(formData.get("pricingMethod") || "MANUAL");
  const rawDiscountValue = String(formData.get("discountValue") || "").trim();
  const rawMinimumOrder = String(formData.get("minimumOrder") || "").trim();

  if (!name || !customerTag) {
    return { error: "Group name and customer tag are required." };
  }

  const discountValue = rawDiscountValue ? Number(rawDiscountValue) : null;
  const minimumOrder = rawMinimumOrder ? Number(rawMinimumOrder) : null;

  if ((discountValue !== null && Number.isNaN(discountValue)) || (minimumOrder !== null && Number.isNaN(minimumOrder))) {
    return { error: "Discount and minimum order must be valid numbers." };
  }

  const data = {
    name,
    customerTag,
    description: description || null,
    pricingMethod,
    discountValue,
    minimumOrder,
  };

  try {
    if (id) {
      await db.wholesaleGroup.updateMany({
        where: { id, shop: session.shop },
        data,
      });
    } else {
      if (groupLimit !== null) {
        const activeGroupCount = await db.wholesaleGroup.count({
          where: { shop: session.shop, isActive: true },
        });

        if (activeGroupCount >= groupLimit) {
          return { error: `Your ${planName || "Free"} plan includes ${groupLimit} active wholesale group${groupLimit === 1 ? "" : "s"}. Pause another group or upgrade your plan to create more groups.` };
        }
      }

      await db.wholesaleGroup.create({
        data: {
          ...data,
          shop: session.shop,
        },
      });
    }
  } catch (error) {
    if (error?.code === "P2002") {
      return { error: "A wholesale group with that customer tag already exists." };
    }
    throw error;
  }

  await syncWholesaleGroupRules({ admin, shop: session.shop, db });

  return { success: true, message: "Wholesale group saved and rules synced." };
};

export default function WholesaleGroups() {
  const { groups, rulesMetafield, subscription } = useLoaderData();
  const actionData = useActionData();
  const submit = useSubmit();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";
  const activeGroups = groups.filter((group) => group.isActive).length;
  const groupLimit = subscription.groupLimit;
  const isGroupLimitReached = groupLimit !== null && activeGroups >= groupLimit;
  const groupLimitLabel = groupLimit === null ? "Unlimited" : `${activeGroups}/${groupLimit}`;

  const handleSubmit = (event) => {
    event.preventDefault();
    submit(new FormData(event.currentTarget), { method: "post" });
    event.currentTarget.reset();
  };

  const submitIntent = (payload) => {
    submit(payload, { method: "post" });
  };

  return (
    <s-page heading="Wholesale Groups" inlineSize="large">
      <div className="page-frame">
        <div className="dashboard-hero">
          <div>
            <h2>Create buyer tiers for richer wholesale pricing.</h2>
            <p className="panel-copy">Groups map customer tags to wholesale tiers. This sets up Gold, Silver, Distributor, or regional buyer logic for the next pricing-rule pass.</p>
          </div>
        </div>

        <div className="metric-grid">
          <div className="metric-tile">
            <span>Total groups</span>
            <strong>{groups.length}</strong>
          </div>
          <div className="metric-tile">
            <span>Active groups</span>
            <strong>{groupLimitLabel}</strong>
          </div>
          <div className="metric-tile">
            <span>Plan</span>
            <strong>{subscription.planName}</strong>
          </div>
          <div className="metric-tile">
            <span>Rules sync</span>
            <strong>{rulesMetafield ? "Ready" : "Needed"}</strong>
          </div>
        </div>

        {actionData?.error && (
          <div className="feedback-banner is-critical">
            {actionData.error}
          </div>
        )}

        {actionData?.success && (
          <div className="feedback-banner is-success">
            {actionData.message || "Wholesale group saved."}
          </div>
        )}

        {isGroupLimitReached && (
          <div className="feedback-banner is-info">
            Your {subscription.planName} plan includes {groupLimit} active wholesale group{groupLimit === 1 ? "" : "s"}. Pause an existing group or upgrade your plan to add more active buyer tiers.
          </div>
        )}

        <div className="app-layout-with-aside">
          <div className="primary-workspace">
            <s-section heading="How group pricing works">
              <div className="help-steps compact-help">
                <div className="help-step">
                  <span>1</span>
                  <div>
                    <strong>Create a group with a supported customer tag</strong>
                    <p>Use tags like B2B_wholesale, B2B_distributor, B2B_vip, B2B_gold, B2B_silver, B2B_dealer, B2B_partner, or B2B_trade for automatic percentage discounts.</p>
                  </div>
                </div>
                <div className="help-step">
                  <span>2</span>
                  <div>
                    <strong>Choose the pricing method</strong>
                    <p>Manual variant prices use the B2B Price set on each product variant. Percentage off retail applies this group discount at checkout.</p>
                  </div>
                </div>
                <div className="help-step">
                  <span>3</span>
                  <div>
                    <strong>Approve buyers into the group</strong>
                    <p>When approving a wholesale application, choose the group. The customer keeps B2B_approved and also receives the selected group tag.</p>
                  </div>
                </div>
              </div>
            </s-section>

            <s-box paddingBlockStart="large" />

            <s-section heading="Groups">
              <div className="section-toolbar">
                <p className="panel-copy">
                  Active group rules sync to a shop metafield for the next pricing-rule checkout pass.
                  {rulesMetafield?.updatedAt ? ` Last synced ${new Date(rulesMetafield.updatedAt).toLocaleString()}.` : " Sync after creating your first group."}
                </p>
                <s-button onClick={() => submitIntent({ intent: "sync" })}>Sync Rules</s-button>
              </div>
              <div className="feedback-banner is-info">
                Percentage-off checkout rules currently support common tags like B2B_wholesale, B2B_distributor, B2B_vip, B2B_gold, B2B_silver, B2B_dealer, B2B_partner, and B2B_trade. Your plan controls how many active wholesale groups can be used at once.
              </div>
              {groups.length === 0 ? (
                <div className="empty-panel">
                  <h3>No wholesale groups yet</h3>
                  <p className="panel-copy">Start with a default tier such as Wholesale, Distributor, or VIP. Customers must have the matching tag in Shopify.</p>
                </div>
              ) : (
                <s-table>
                  <s-table-header-row>
                    <s-table-header>Group</s-table-header>
                    <s-table-header>Customer tag</s-table-header>
                    <s-table-header>Pricing</s-table-header>
                    <s-table-header>Status</s-table-header>
                    <s-table-header>Actions</s-table-header>
                  </s-table-header-row>
                  <s-table-body>
                    {groups.map((group) => (
                      <s-table-row key={group.id}>
                        <s-table-cell>
                          <div>
                            <s-text type="strong">{group.name}</s-text>
                            {group.description && <p className="table-note">{group.description}</p>}
                          </div>
                        </s-table-cell>
                        <s-table-cell>{group.customerTag}</s-table-cell>
                        <s-table-cell>
                          {group.pricingMethod === "PERCENTAGE_OFF" && group.discountValue !== null
                            ? `${group.discountValue}% off`
                            : "Manual prices"}
                          {group.minimumOrder !== null && <p className="table-note">Min order ${Number(group.minimumOrder).toFixed(2)}</p>}
                        </s-table-cell>
                        <s-table-cell>
                          <s-badge tone={group.isActive ? "success" : "subdued"}>{group.isActive ? "Active" : "Paused"}</s-badge>
                        </s-table-cell>
                        <s-table-cell>
                          <div className="button-row">
                            <s-button
                              size="slim"
                              onClick={() => submitIntent({ intent: "toggle", id: String(group.id) })}
                            >
                              {group.isActive ? "Pause" : "Activate"}
                            </s-button>
                            <s-button
                              size="slim"
                              tone="critical"
                              onClick={() => submitIntent({ intent: "delete", id: String(group.id) })}
                            >
                              Delete
                            </s-button>
                          </div>
                        </s-table-cell>
                      </s-table-row>
                    ))}
                  </s-table-body>
                </s-table>
              )}
            </s-section>
          </div>

          <s-section heading="Create group">
            <form className="settings-panel" method="post" onSubmit={handleSubmit}>
              <input type="hidden" name="intent" value="save" />
              <label>
                Group name
                <input name="name" placeholder="Distributor" required />
              </label>
              <label>
                Customer tag
                <input name="customerTag" placeholder="B2B_distributor" list="supported-wholesale-tags" required />
                <span>Use a supported tag for percentage-off checkout rules. Custom tags can still be used for manual grouping and future rules.</span>
                <datalist id="supported-wholesale-tags">
                  <option value="B2B_wholesale" />
                  <option value="B2B_distributor" />
                  <option value="B2B_vip" />
                  <option value="B2B_gold" />
                  <option value="B2B_silver" />
                  <option value="B2B_dealer" />
                  <option value="B2B_partner" />
                  <option value="B2B_trade" />
                </datalist>
              </label>
              <label>
                Description
                <textarea name="description" placeholder="Optional notes for your team" rows="3" />
              </label>
              <label>
                Pricing method
                <select name="pricingMethod" defaultValue="MANUAL">
                  <option value="MANUAL">Manual variant prices</option>
                  <option value="PERCENTAGE_OFF">Percentage off retail</option>
                </select>
                <span>Manual uses the B2B Price column on variants. Percentage off applies the discount value below to retail prices.</span>
              </label>
              <label>
                Discount value
                <input name="discountValue" type="number" min="0" step="0.01" placeholder="15" />
                <span>Only needed for Percentage off retail. Example: 15 means 15% off.</span>
              </label>
              <label>
                Minimum order
                <input name="minimumOrder" type="number" min="0" step="0.01" placeholder="500" />
                <span>Optional. Overrides the default wholesale minimum order for this group.</span>
              </label>
              <button className="primary-action-button" type="submit" disabled={isSubmitting || isGroupLimitReached}>
                {isGroupLimitReached ? "Group limit reached" : "Create group"}
              </button>
              {isGroupLimitReached && (
                <span>Your current plan includes {groupLimit} active group{groupLimit === 1 ? "" : "s"}. Pause a group or upgrade before creating another active group.</span>
              )}
            </form>
          </s-section>
        </div>
      </div>
    </s-page>
  );
}
