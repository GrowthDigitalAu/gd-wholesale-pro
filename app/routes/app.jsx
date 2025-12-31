import { Outlet, useLoaderData, useRouteError, Link, useLocation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { NavMenu } from "@shopify/app-bridge-react";
import { AppProvider as PolarisAppProvider } from "@shopify/polaris";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";
import translations from "@shopify/polaris/locales/en.json";
import { authenticate } from "../shopify.server";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

export const loader = async ({ request }) => {
  await authenticate.admin(request);

  // eslint-disable-next-line no-undef
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export default function App() {
  const { apiKey } = useLoaderData();

  return (
    <AppProvider embedded apiKey={apiKey}>
      <NavMenu>
        <s-link href="/app" rel="home">Home</s-link>
        <s-link href="/app/forms">Custom Forms</s-link>
        <s-link href="/app/b2b-pricing">B2B Product Price</s-link>
        <s-link href="/app/import-product-prices">Import Product Prices</s-link>
        <s-link href="/app/export-product-prices">Export Product Prices</s-link>
        <s-link href="/app/how-to-use">How To Use</s-link>
      </NavMenu>
      <PolarisAppProvider i18n={translations} linkComponent={LinkAdapter}>
        <Outlet />
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
