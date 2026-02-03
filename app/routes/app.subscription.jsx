import { useLoaderData, Form, useSubmit } from "react-router";
import {
  Page,
  Layout,
  Text,
  Card,
  Button,
  BlockStack,
  Box,
  Divider,
  Banner,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);

  const billingCheck = await admin.graphql(
    `#graphql
      query {
        currentAppInstallation {
          activeSubscriptions {
            id
            name
            status
            test
          }
        }
      }
    `
  );

  const billingJson = await billingCheck.json();
  const activeSubscriptions =
    billingJson.data?.currentAppInstallation?.activeSubscriptions || [];
  
  const shopName = session.shop.replace(".myshopify.com", "");

  return {
    subscription: activeSubscriptions[0] || null,
    manageUrl: `https://admin.shopify.com/store/${shopName}/charges/gd-priceupdator-pro/pricing_plans`,
  };
};

export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const subscriptionId = formData.get("subscriptionId");

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

  if (errors && errors.length > 0) {
    return { error: errors[0].message };
  }

  return { success: true };
};

export default function SubscriptionPage() {
  const { subscription, manageUrl } = useLoaderData();
  const submit = useSubmit();

  const handleCancel = () => {
    if (confirm("Are you sure you want to cancel your subscription?")) {
      submit(
        { subscriptionId: subscription.id },
        { method: "POST" }
      );
    }
  };

  return (
    <Page title="Subscription">
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                Current Plan
              </Text>
              
              {subscription ? (
                <Box>
                  <Text as="p" variant="bodyMd" fontWeight="bold">
                    {subscription.name}
                  </Text>
                  <Text as="p" variant="bodySm" tone={subscription.status === 'ACTIVE' ? 'success' : 'critical'}>
                    Status: {subscription.status}
                  </Text>
                  {subscription.test && (
                    <Text as="p" variant="bodySm" tone="subdued">
                      (Test Charge)
                    </Text>
                  )}
                </Box>
              ) : (
                <Text as="p" tone="critical">
                  No active subscription found.
                </Text>
              )}

              <Divider />

              <BlockStack gap="200">
                <Text as="p" variant="bodyMd">
                  {subscription 
                    ? "Manage or cancel your plan below." 
                    : "You need a subscription to use this app."}
                </Text>
                
                <BlockStack gap="200" inlineAlign="start">
                   <Button url={manageUrl} target="_top" variant="primary">
                    {subscription ? "Change Plan" : "Choose a Plan"}
                  </Button>
                  
                  {subscription && (
                    <Button tone="critical" onClick={handleCancel}>
                      Cancel Subscription
                    </Button>
                  )}
                </BlockStack>
              </BlockStack>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
