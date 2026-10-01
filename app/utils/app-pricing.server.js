const ACTIVE_SUBSCRIPTION_QUERY = `query ActiveSubscription($appId: ID!, $shopId: ID!) {
  activeSubscription(appId: $appId, shopId: $shopId) {
    legacySubscriptionId billingPeriod cancelAtEndOfCycle trialEndsAt
    currentBillingCycle { startTime endTime }
    items { handle description price { active } }
    pendingUpdate { billingPeriod items { handle description } }
  }
}`;

export function normalizeSubscription(contract, planHandles = {}) {
  if (!contract) return null;
  const item = contract.items?.find((entry) => entry.price?.active);
  if (!item) throw new Error("Subscription has no active pricing item.");
  const name = [planHandles[item.handle], item.handle, item.description]
    .find((candidate) => typeof candidate === "string" && /\b(free|startup|growth|expand)\b/i.test(candidate.replace(/_/g, " ")));
  if (!name) {
    throw new Error(
      "Unknown subscription plan. Configure SHOPIFY_APP_PRICING_PLAN_HANDLES.",
    );
  }
  return {
    id: contract.legacySubscriptionId,
    name,
    status: "ACTIVE",
    source: "partner_api",
    billingPeriod: contract.billingPeriod,
    trialEndsAt: contract.trialEndsAt,
    cancelAtEndOfCycle: contract.cancelAtEndOfCycle,
    currentBillingCycle: contract.currentBillingCycle,
    pendingUpdate: contract.pendingUpdate,
  };
}

export async function getAppSubscription({ admin }) {
  // Credentials belong to the Partner organization, never to a merchant session.
  const {
    SHOPIFY_PARTNER_ORG_ID: orgId,
    SHOPIFY_PARTNER_API_ACCESS_TOKEN: token,
    SHOPIFY_PARTNER_APP_ID: appId,
    SHOPIFY_PARTNER_API_VERSION: version = "2026-07",
    SHOPIFY_APP_PRICING_PLAN_HANDLES: handles = "{}",
  } = Object.fromEntries(Object.entries(process.env).map(([key, value]) => [key, value?.trim()]));
  if (!orgId && !token && !appId) {
    const response = await admin.graphql(`query LegacySubscription {
      currentAppInstallation { activeSubscriptions { id name status test } }
    }`);
    const json = await response.json();
    if (json.errors?.length || !json.data?.currentAppInstallation) {
      throw new Error("Unable to verify legacy subscription.");
    }
    return json.data.currentAppInstallation.activeSubscriptions
      .filter((subscription) => subscription.status === "ACTIVE")
      .map((subscription) => ({ ...subscription, source: "billing_api" }));
  }
  if (
    !orgId ||
    !token ||
    !appId ||
    !/^\d+$/.test(orgId) ||
    !/^\d{4}-\d{2}$/.test(version)
  ) {
    const missing = [!orgId && "SHOPIFY_PARTNER_ORG_ID", !token && "SHOPIFY_PARTNER_API_ACCESS_TOKEN", !appId && "SHOPIFY_PARTNER_APP_ID"].filter(Boolean);
    throw new Error(missing.length ? `Missing Partner API configuration: ${missing.join(", ")}` : "Invalid Partner organization ID or API version. Use the numeric organization ID and YYYY-MM API version.");
  }
  if (!/^(\d+|gid:\/\/shopify\/App\/\d+)$/.test(appId)) {
    throw new Error("Invalid SHOPIFY_PARTNER_APP_ID. Use the numeric Partner app ID, not the OAuth client ID.");
  }
  const shopResponse = await admin.graphql(
    `query SubscriptionShop { shop { id } }`,
  );
  const shopJson = await shopResponse.json();
  if (shopJson.errors?.length || !shopJson.data?.shop?.id) {
    throw new Error("Unable to verify subscription shop.");
  }
  const response = await fetch(
    `https://partners.shopify.com/${orgId}/api/${version}/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": token,
      },
      body: JSON.stringify({
        query: ACTIVE_SUBSCRIPTION_QUERY,
        variables: {
          appId: appId.startsWith("gid://")
            ? appId
            : `gid://shopify/App/${appId}`,
          shopId: shopJson.data.shop.id,
        },
      }),
      signal: AbortSignal.timeout(10000),
    },
  );
  if (!response.ok)
    throw new Error(
      `Partner subscription request failed (${response.status}).`,
    );
  const json = await response.json();
  if (
    json.errors?.length ||
    !json.data ||
    !("activeSubscription" in json.data)
  ) {
    // Shopify's response identifies permission/schema/enrollment failures. Keep
    // it in server logs and remove the access token if it is ever echoed.
    const details = (json.errors || []).map((error) => String(error.message || "Unknown GraphQL error").split(token).join("[redacted]")).join("; ");
    throw new Error(`Partner API could not verify subscription: ${details || "Missing subscription data"}`);
  }
  const subscription = normalizeSubscription(
    json.data.activeSubscription,
    JSON.parse(handles),
  );
  return subscription ? [subscription] : [];
}

// Adapter keeps existing route response shapes while consolidating billing reads.
export async function getAppBillingResponse(admin) {
  const activeSubscriptions = await getAppSubscription({ admin });
  const response = await admin.graphql(`query BillingShop { shop {
    id metafield(namespace: "gd_price_updator", key: "verified_plan") { value }
  } }`);
  const json = await response.json();
  if (json.errors?.length || !json.data?.shop?.id)
    throw new Error("Unable to read billing shop.");
  return {
    json: async () => ({
      data: {
        currentAppInstallation: { activeSubscriptions },
        shop: json.data.shop,
      },
    }),
  };
}
