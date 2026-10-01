import { getAppBillingResponse, getPricingPlansUrl } from "../utils/app-pricing.server";
import { Outlet, useLoaderData, useRouteError, Link, useLocation, useNavigate, useNavigation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { NavMenu } from "@shopify/app-bridge-react";
import { AppProvider as PolarisAppProvider } from "@shopify/polaris";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";
import appStyles from "../styles/app.css?url";
import translations from "@shopify/polaris/locales/en.json";
import { authenticate } from "../shopify.server";
import { useEffect } from "react";
import { enforceSubscriptionLimits } from "../utils/subscription-sync.server";

export const links = () => [
  { rel: "stylesheet", href: polarisStyles },
  { rel: "stylesheet", href: appStyles }
];

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);

  let hasActiveSubscription = false;
  let developmentPreview = false;

  try {
    const billingCheck = await getAppBillingResponse(admin);

    const billingJson = await billingCheck.json();
    const activeSubscriptions =
      billingJson.data?.currentAppInstallation?.activeSubscriptions || [];
    developmentPreview = activeSubscriptions[0]?.source === "development";
    const shopId = billingJson.data?.shop?.id;

    const verifiedPlan = activeSubscriptions[0]?.name || "Free";
    if (activeSubscriptions.length > 0 && billingJson.data.shop.metafield?.value !== verifiedPlan) {
      await enforceSubscriptionLimits({ admin, shop: session.shop, subscription: activeSubscriptions[0] || null });
    }

    const isActive = activeSubscriptions.length > 0;

    if (shopId) {
      const syncResponse = await admin.graphql(
        `#graphql
        mutation MetafieldsSet($metafields: [MetafieldsSetInput!]!) {
          metafieldsSet(metafields: $metafields) {
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
                namespace: "gd_price_updator",
                key: "subscription_active",
                type: "single_line_text_field",
                value: isActive ? "true" : "false"
              },
              {
                ownerId: shopId,
                namespace: "gd_price_updator",
                key: "verified_plan",
                type: "single_line_text_field",
                value: verifiedPlan
              }
            ]
          }
        }
      );
      const syncJson = await syncResponse.json();
      if (syncJson.errors?.length || !syncJson.data?.metafieldsSet || syncJson.data.metafieldsSet.userErrors?.length) {
        throw new Error("Unable to sync subscription state.");
      }
    }

    if (activeSubscriptions.length > 0) {
      hasActiveSubscription = true;
    }
  } catch (error) {
    if (error instanceof Response) {
      throw error;
    }
    console.error("Billing check failed:", error.message);
    throw new Response("Unable to verify your plan. Please try again shortly.", { status: 503 });
  }

  // eslint-disable-next-line no-undef
  return { apiKey: process.env.SHOPIFY_API_KEY || "", hasActiveSubscription, developmentPreview, pricingPlansUrl: getPricingPlansUrl(session.shop) };
};

export default function App() {
  const { apiKey, hasActiveSubscription, developmentPreview, pricingPlansUrl } = useLoaderData();
  const navigate = useNavigate();
  const location = useLocation();
  const navigation = useNavigation();

  // Only show loading bar when navigating to a different route
  // Hide it when navigating WITHIN forms (from forms list to form editor or vice versa)
  const isNavigatingWithinForms = 
    (location.pathname.startsWith("/app/forms") && navigation.location?.pathname?.startsWith("/app/forms"));
  const isLoading = navigation.state === "loading" && navigation.location?.pathname !== location.pathname && !isNavigatingWithinForms;

  useEffect(() => {
    if (!hasActiveSubscription && location.pathname !== "/app/subscription") {
      navigate("/app/subscription");
    }
  }, [hasActiveSubscription, location.pathname, navigate]);

  const isOnSubscriptionPage = location.pathname === "/app/subscription";
  const showContent = hasActiveSubscription || isOnSubscriptionPage;

  return (
    <AppProvider embedded apiKey={apiKey}>
      {/* Top Loading Progress Bar */}
      {isLoading && <div className="loading-bar" />}
      
      <NavMenu>
        <s-link href="/app" rel="home">GD: Wholesale Pro</s-link>
        <s-link href="/app/forms">Wholesale Applications</s-link>
        <s-link href="/app/groups">Wholesale Groups</s-link>
        <s-link href="/app/b2b-pricing">Wholesale Pricing</s-link>
        {developmentPreview
          ? <s-link href="/app/subscription">Development preview</s-link>
          : <s-link href={pricingPlansUrl} target="_top">Subscription</s-link>}
        <s-link href="/app/how-to-use">Setup Guide</s-link>
      </NavMenu>
      <PolarisAppProvider i18n={translations} linkComponent={LinkAdapter}>
        {showContent ? <Outlet /> : null}
      </PolarisAppProvider>
    </AppProvider>
  );
}

function LinkAdapter({ url, children, ...rest }) {
  const location = useLocation();
  const to = typeof url === 'string' && url.startsWith('/') 
    ? `${url}${location.search}`
    : url;

  return (
    <Link to={to} {...rest}>
      {children}
    </Link>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
