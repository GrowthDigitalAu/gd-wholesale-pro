import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  return null;
};

export default function Index() {
  return (
    <s-page heading="Welcome to Price Updater">
      <s-box paddingBlockStart="large" paddingBlockEnd="large">
        <s-section heading="Use the sidebar to access Price Update features.">
          <s-paragraph>
            This app allows you to bulk edit your product prices in your Shopify store.
          </s-paragraph>
        </s-section>
      </s-box>
    </s-page>
  );
}
