import { authenticate } from "../shopify.server";
import { getAppSubscription } from "../utils/app-pricing.server";
import { enforceSubscriptionLimits } from "../utils/subscription-sync.server";

export const action = async ({ request }) => {
  const { admin, shop } = await authenticate.webhook(request);
  if (!admin) return new Response(null, { status: 200 });
  const subscriptions = await getAppSubscription({ admin });
  await enforceSubscriptionLimits({ admin, shop, subscription: subscriptions[0] || null });
  return new Response(null, { status: 200 });
};
