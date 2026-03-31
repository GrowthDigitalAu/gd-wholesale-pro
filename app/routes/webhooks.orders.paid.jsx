import { authenticate } from "../shopify.server";

export const action = async ({ request }) => {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  let admin, payload;
  try {
    const auth = await authenticate.webhook(request);
    admin = auth.admin;
    payload = auth.payload;
  } catch (authError) {
    return new Response("Webhook HMAC validation failed", { status: 401 });
  }

  try {
    const customerId = payload?.customer?.id;
    const discountApplications = payload?.discount_applications || [];

    if (!customerId) {
      return new Response("Webhook received (no customer)", { status: 200 });
    }

    const hasB2BDiscount = discountApplications.some(
      (d) => (d.title || "").trim().toLowerCase() === "b2b wholesale price"
    );

    if (!hasB2BDiscount) {
      return new Response("Webhook received (no B2B discount)", { status: 200 });
    }

    const gid = `gid://shopify/Customer/${customerId}`;
    const customerRes = await admin.graphql(
      `#graphql
      query GetCustomerTags($id: ID!) {
        customer(id: $id) {
          id
          tags
        }
      }`,
      { variables: { id: gid } }
    );

    const customerJson = await customerRes.json();
    const customer = customerJson.data?.customer;

    if (!customer) {
      return new Response("Webhook error (could not fetch customer)", { status: 200 });
    }

    if (customer.tags.includes("old_b2b_customer")) {
      return new Response("Webhook received (already tagged)", { status: 200 });
    }

    const updatedTags = [...customer.tags, "old_b2b_customer"];

    await admin.graphql(
      `#graphql
      mutation UpdateCustomerTags($input: CustomerInput!) {
        customerUpdate(input: $input) {
          customer { id tags }
          userErrors { field message }
        }
      }`,
      {
        variables: {
          input: {
            id: gid,
            tags: updatedTags,
          },
        },
      }
    );

    return new Response("Webhook received and processed", { status: 200 });
  } catch (err) {
    return new Response("Webhook processed with internal errors", { status: 200 });
  }
};
