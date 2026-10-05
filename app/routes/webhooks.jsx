import { authenticate } from "../shopify.server";
import db from "../db.server";

export const loader = async () => {
    return new Response("Webhook endpoint is active", { status: 200 });
};

export const action = async ({ request }) => {
    if (request.method !== "POST") {
        return new Response("Method not allowed", { status: 405 });
    }

    try {
        // Shopify's authenticate.webhook() already handles HMAC verification
        const { shop, payload, topic } = await authenticate.webhook(request);

        console.log(`Received ${topic} webhook from ${shop}`);
        // console.log("Payload:", JSON.stringify(payload, null, 2));

        switch (topic) {

            case "CUSTOMERS_DATA_REQUEST":
                console.log(`Customer data request received for ${shop}; review saved-order-list export in the admin app.`);
                break;

            case "CUSTOMERS_REDACT":
                if (payload.customer?.id) await db.savedOrderList.deleteMany({ where: { shop, customerId: String(payload.customer.id) } });
                console.log(`Saved order lists redacted for ${shop}.`);
                break;

            case "SHOP_REDACT":
                await db.savedOrderList.deleteMany({ where: { shop } });
                await db.pricingAudit.deleteMany({ where: { shop } });
                console.log(`Saved lists and pricing history redacted for ${shop}.`);
                break;

            default:
                console.warn(`❌ Unhandled webhook topic: ${topic}`);
                // Don't return 400 for unhandled topics, just accept them to avoid retries
                // or you can return 400 if you strictly want to only handle known topics.
        }

        // Return 200 only if authentication and processing succeeded
        return new Response("Webhook received", { status: 200 });

    } catch (authError) {
        // Specifically handle HMAC validation failures
        console.error("🔒 Webhook authentication failed:", authError);
        return new Response("Webhook HMAC validation failed", { status: 401 });
    }

};
