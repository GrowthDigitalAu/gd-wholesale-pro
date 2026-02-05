import { authenticate } from "../shopify.server";
import { getVariantLimitForPlan } from "../utils/subscription";

export const action = async ({ request }) => {
    try {
        const { admin, shop, topic, payload } = await authenticate.webhook(request);
        
        console.log(`📬 Received ${topic} webhook from ${shop}`);
        
        // Extract new subscription details from payload
        const appSubscription = payload?.app_subscription;
        
        if (!appSubscription) {
            console.error("❌ No app_subscription in webhook payload");
            return new Response("Invalid payload", { status: 400 });
        }
        
        const newPlanName = appSubscription.name || null;
        const newLimit = getVariantLimitForPlan(newPlanName);
        
        console.log(`📊 Plan changed to: ${newPlanName || "Free"}, New limit: ${newLimit || "unlimited"}`);
        
        // Only cleanup if there's a limit (not unlimited)
        if (newLimit !== null) {
            // Query all variants with B2B prices
            const allVariantsResponse = await admin.graphql(
                `#graphql
                query {
                    productVariants(first: 250) {
                        edges {
                            node {
                                id
                                updatedAt
                                metafield(namespace: "$app", key: "gd_b2b_price") {
                                    id
                                    value
                                }
                            }
                        }
                    }
                }`
            );
            
            const allVariantsJson = await allVariantsResponse.json();
            const variantsWithB2B = [];
            
            allVariantsJson.data?.productVariants?.edges.forEach(({ node }) => {
                const b2bValue = node.metafield?.value;
                if (b2bValue !== undefined && b2bValue !== null && parseFloat(b2bValue) > 0) {
                    variantsWithB2B.push({
                        id: node.id,
                        metafieldId: node.metafield.id,
                        value: parseFloat(b2bValue),
                        updatedAt: node.updatedAt
                    });
                }
            });
            
            console.log(`📈 Current B2B variant count: ${variantsWithB2B.length}/${newLimit}`);
            
            if (variantsWithB2B.length > newLimit) {
                // Sort by updatedAt (oldest first)
                variantsWithB2B.sort((a, b) => new Date(a.updatedAt) - new Date(b.updatedAt));
                
                // Remove the oldest variants to bring count down to new limit
                const toRemove = variantsWithB2B.slice(0, variantsWithB2B.length - newLimit);
                
                console.log(`🧹 Removing ${toRemove.length} oldest B2B prices to comply with new limit`);
                
                for (const variant of toRemove) {
                    await admin.graphql(
                        `#graphql
                        mutation metafieldsDelete($metafields: [MetafieldIdentifierInput!]!) {
                            metafieldsDelete(metafields: $metafields) {
                                deletedMetafields {
                                    key
                                    namespace
                                    ownerId
                                }
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
                                        ownerId: variant.id,
                                        namespace: "$app",
                                        key: "gd_b2b_price"
                                    }
                                ]
                            }
                        }
                    );
                }
                
                console.log(`✅ Auto-removed ${toRemove.length} B2B prices after plan change (new limit: ${newLimit})`);
            } else {
                console.log(`✅ No cleanup needed. Current count (${variantsWithB2B.length}) is within limit (${newLimit})`);
            }
        } else {
            console.log(`✅ Unlimited plan - no cleanup needed`);
        }
        
        return new Response("Webhook processed successfully", { status: 200 });
        
    } catch (error) {
        console.error("❌ Error processing subscription update webhook:", error);
        return new Response("Webhook processing failed", { status: 500 });
    }
};
