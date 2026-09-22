import { authenticate } from "../shopify.server";
import db from "../db.server";
import { getGroupLimitForPlan, getVariantLimitForPlan } from "../utils/subscription";
import { syncWholesaleGroupRules } from "../utils/wholesale-groups.server";

function hasGroupPriceValue(value) {
    if (!value) return false;

    try {
        const groupPrices = JSON.parse(value);
        return Object.values(groupPrices).some((price) => Number(price) > 0);
    } catch {
        return false;
    }
}

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
        const newLimit = getVariantLimitForPlan(newPlanName, shop);
        const newGroupLimit = getGroupLimitForPlan(newPlanName);
        
        console.log(`📊 Plan changed to: ${newPlanName || "Free"}, New variant limit: ${newLimit || "unlimited"}, New group limit: ${newGroupLimit || "unlimited"}`);
        
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
                                groupPriceMetafield: metafield(namespace: "$app", key: "gd_b2b_group_prices") {
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
                const hasDefaultB2BPrice = b2bValue !== undefined && b2bValue !== null && parseFloat(b2bValue) > 0;
                const hasGroupB2BPrice = hasGroupPriceValue(node.groupPriceMetafield?.value);

                if (hasDefaultB2BPrice || hasGroupB2BPrice) {
                    variantsWithB2B.push({
                        id: node.id,
                        metafieldId: node.metafield?.id || null,
                        groupPriceMetafieldId: node.groupPriceMetafield?.id || null,
                        value: hasDefaultB2BPrice ? parseFloat(b2bValue) : null,
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
                    const metafields = [
                        {
                            ownerId: variant.id,
                            namespace: "$app",
                            key: "gd_b2b_price"
                        },
                        {
                            ownerId: variant.id,
                            namespace: "$app",
                            key: "gd_b2b_group_prices"
                        }
                    ];

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
                                metafields
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

        if (newGroupLimit !== null) {
            const activeGroups = await db.wholesaleGroup.findMany({
                where: { shop, isActive: true },
                orderBy: [{ createdAt: "asc" }],
            });

            if (activeGroups.length > newGroupLimit) {
                const groupsToPause = activeGroups.slice(newGroupLimit);

                await db.wholesaleGroup.updateMany({
                    where: {
                        shop,
                        id: { in: groupsToPause.map((group) => group.id) },
                    },
                    data: { isActive: false },
                });

                await syncWholesaleGroupRules({ admin, shop, db });
                console.log(`✅ Paused ${groupsToPause.length} wholesale group(s) after plan change (new limit: ${newGroupLimit})`);
            } else {
                console.log(`✅ No group cleanup needed. Active groups (${activeGroups.length}) are within limit (${newGroupLimit})`);
            }
        }
        
        return new Response("Webhook processed successfully", { status: 200 });
        
    } catch (error) {
        console.error("❌ Error processing subscription update webhook:", error);
        return new Response("Webhook processing failed", { status: 500 });
    }
};
