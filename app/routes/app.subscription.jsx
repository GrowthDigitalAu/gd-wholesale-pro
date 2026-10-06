import { getAppBillingResponse, getPricingPlansUrl } from "../utils/app-pricing.server";
import { useState } from "react";
import { useLoaderData, useSubmit, useNavigation, useActionData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import {
  Text,
  Button,
  BlockStack,
  Box,
  Divider,
  Modal,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import PlanSelection from "../components/plan-selection";

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => boundary.headers(headersArgs);

const PLAN_FEATURES = [
  {
    name: "Free",
    price: "$0",
    groups: "1 active group",
    variants: "10 active B2B pricing variants",
    bestFor: "Testing the workflow on a small catalog.",
  },
  {
    name: "Startup",
    price: "$10 / 30 days",
    groups: "3 active groups",
    variants: "100 active B2B pricing variants",
    bestFor: "Matching Shopify's default 3 catalog baseline with approval and manual pricing tools.",
  },
  {
    name: "Growth",
    price: "$30 / 30 days",
    groups: "10 active groups",
    variants: "500 active B2B pricing variants",
    bestFor: "Running multiple wholesale, distributor, VIP, regional, or trade tiers.",
  },
  {
    name: "Expand",
    price: "$50 / 30 days",
    groups: "Unlimited active groups",
    variants: "Unlimited active B2B pricing variants",
    bestFor: "Large catalogs and advanced wholesale programs.",
  },
];

export const loader = async ({ request }) => {
  const { admin, session, redirect } = await authenticate.admin(request);

  const billingCheck = await getAppBillingResponse(admin);

  const billingJson = await billingCheck.json();
  const activeSubscriptions =
    billingJson.data?.currentAppInstallation?.activeSubscriptions || [];
  
  const manageUrl = getPricingPlansUrl(session.shop);
  if (new URL(request.url).searchParams.has("plan_handle") && activeSubscriptions.length > 0) {
    return redirect("/app");
  }

  return {
    subscription: activeSubscriptions[0] || null,
    manageUrl,
  };
};

export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const subscriptionId = formData.get("subscriptionId");
  const billing = await getAppBillingResponse(admin);
  const verified = (await billing.json()).data.currentAppInstallation.activeSubscriptions[0];
  if (!verified || verified.source !== "billing_api" || verified.id !== subscriptionId) {
    return { error: "Manage this subscription on Shopify's plan selection page." };
  }

  if (!subscriptionId) {
    return { error: "Subscription ID is required" };
  }

  const response = await admin.graphql(
    `#graphql
      mutation AppSubscriptionCancel($id: ID!) {
        appSubscriptionCancel(id: $id) {
          appSubscription {
            id
            status
            test
          }
          userErrors {
            field
            message
          }
        }
      }
    `,
    {
      variables: {
        id: subscriptionId,
      },
    }
  );

  const responseJson = await response.json();
  const errors = responseJson.data?.appSubscriptionCancel?.userErrors;
  if (responseJson.errors?.length || !responseJson.data?.appSubscriptionCancel?.appSubscription || errors?.length) {
    return { error: errors?.[0]?.message || "Unable to cancel your subscription. Please try again." };
  }

  // Sync only after Shopify confirms cancellation.
  try {
     const shopQuery = await admin.graphql(`query { shop { id } }`);
     const shopJson = await shopQuery.json();
     const shopId = shopJson.data?.shop?.id;
     
     if (shopId) {
        await admin.graphql(
          `#graphql
          mutation MetafieldsSet($metafields: [MetafieldsSetInput!]!) {
            metafieldsSet(metafields: $metafields) {
              userErrors { field message }
            }
          }`,
          {
            variables: {
              metafields: [
                {
                  ownerId: shopId,
                  namespace: "gd_price_updator",
                  key: "subscription_active",
                  type: "single_line_text_field",
                  value: "false"
                }
              ]
            }
          }
        );
     }
  } catch (e) {
    console.error("Failed to sync metafield on cancel:", e);
  }

  return { success: true };
};

export default function SubscriptionPage() {
  const { subscription, manageUrl } = useLoaderData();
  const actionData = useActionData();
  const submit = useSubmit();
  const navigation = useNavigation();
  const [modalOpen, setModalOpen] = useState(false);

  const isSubmitting = navigation.state === "submitting";

  const handleCancel = () => {
    setModalOpen(true);
  };

  const confirmCancel = () => {
    setModalOpen(false);
    submit(
      { subscriptionId: subscription.id },
      { method: "POST" }
    );
  };

  if (!subscription) return <PlanSelection />;

  return (
    <s-page heading="Subscription">
      <s-box paddingBlockStart="large">
        <s-section>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">
              Current Plan
            </Text>
            {actionData?.error && <Text as="p" tone="critical">{actionData.error}</Text>}
            
            {subscription ? (
              <Box>
                <Text as="p" variant="bodyMd" fontWeight="bold">
                  {subscription.name}
                </Text>
                <Text as="p" variant="bodySm" tone={subscription.status === 'ACTIVE' ? 'success' : 'critical'}>
                  Status: {subscription.status}
                </Text>
                {subscription.source === "development" && (
                  <Text as="p" variant="bodyMd">Free development access with unlimited groups and pricing variants. No subscription is required while Shopify identifies this as a development store. When it moves to a live plan, select an app plan and approve any available trial through Shopify.</Text>
                )}
                {subscription.test && subscription.source !== "development" && (
                  <Text as="p" variant="bodySm" tone="subdued">
                    (Test Charge)
                  </Text>
                )}
                {subscription.trialEndsAt && <Text as="p">Trial ends: {new Date(subscription.trialEndsAt).toLocaleDateString()}</Text>}
                {subscription.cancelAtEndOfCycle && <Text as="p">Cancellation scheduled for the end of your billing cycle.</Text>}
                {subscription.pendingUpdate && <Text as="p">A plan change is scheduled for your next billing cycle. Current limits apply until then.</Text>}
              </Box>
            ) : (
              <Text as="p" tone="critical">
                No active subscription found.
              </Text>
            )}

            <Divider />

            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                Plan limits
              </Text>
              <div className="import-guide-grid">
                {PLAN_FEATURES.map((plan) => (
                  <div key={plan.name}>
                    <h3>{plan.name}</h3>
                    <p className="panel-copy"><strong>{plan.price}</strong></p>
                    <p className="panel-copy">{plan.groups}</p>
                    <p className="panel-copy">{plan.variants}</p>
                    <p className="panel-copy">{plan.bestFor}</p>
                  </div>
                ))}
              </div>
            </BlockStack>

            <Divider />

            <BlockStack gap="200">
              <Text as="p" variant="bodyMd">
                {subscription?.source === "development" ? "You can continue setting up and testing your wholesale store for free." : subscription
                  ? "Change or cancel your plan below." 
                  : "You need a subscription to use this app."}
              </Text>
              
              <BlockStack gap="200" inlineAlign="start">
                {subscription?.source !== "development" && <Button url={manageUrl} target="_top" variant="primary">
                  {subscription ? "Change Plan" : "Choose a Plan"}
                </Button>}
                
                {subscription?.source === "billing_api" && (
                  <Button tone="critical" onClick={handleCancel} loading={isSubmitting}>
                    Cancel Subscription
                  </Button>
                )}
              </BlockStack>
            </BlockStack>
          </BlockStack>
        </s-section>
      </s-box>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Cancel Subscription"
        primaryAction={{
          content: 'Cancel Subscription',
          onAction: confirmCancel,
          destructive: true,
          loading: isSubmitting,
        }}
        secondaryActions={[
          {
            content: 'Keep Subscription',
            onAction: () => setModalOpen(false),
          },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            <p>
              Are you sure you want to cancel your subscription? You will lose access to app features immediately.
            </p>
          </BlockStack>
        </Modal.Section>
      </Modal>
    </s-page>
  );
}
