import { useState, useEffect } from "react";
import { useLoaderData, useFetcher, useNavigate, useSearchParams, useNavigation } from "react-router";
import { authenticate } from "../shopify.server";
import { useAppBridge } from "@shopify/app-bridge-react";
import { Pagination, Banner, InlineStack, Text, BlockStack } from "@shopify/polaris";
import { getVariantLimitForPlan } from "../utils/subscription";

export const loader = async ({ request }) => {
    const { admin, session } = await authenticate.admin(request);
    const url = new URL(request.url);
    const cursor = url.searchParams.get("cursor");
    const direction = url.searchParams.get("direction");
    const rawQuery = url.searchParams.get("query") || "";
    const query = rawQuery ? `(title:*${rawQuery}* OR sku:*${rawQuery}*)` : "";


    const billingCheck = await admin.graphql(
        `#graphql
        query {
            currentAppInstallation {
                activeSubscriptions {
                    id
                    name
                    status
                }
            }
        }`
    );

    const billingJson = await billingCheck.json();
    const activeSubscriptions = billingJson.data?.currentAppInstallation?.activeSubscriptions || [];
    const subscription = activeSubscriptions[0] || null;
    const planName = subscription?.name || null;
    const variantLimit = getVariantLimitForPlan(planName);

    let queryVariables = {
        first: 10,
        query: query,
    };

    if (cursor) {
        if (direction === "previous") {
            queryVariables = {
                last: 10,
                before: cursor,
                query: query,
            };
        } else {
            queryVariables = {
                first: 10,
                after: cursor,
                query: query,
            };
        }
    }

    const response = await admin.graphql(
        `#graphql
        query getProducts($first: Int, $last: Int, $after: String, $before: String, $query: String) {
            productsCount(query: $query) {
                count
            }
            products(first: $first, last: $last, after: $after, before: $before, query: $query) {
                edges {
                    cursor
                    node {
                        id
                        title
                        featuredImage {
                            url
                            altText
                        }
                        variants(first: 100) {
                            edges {
                                node {
                                    id
                                    title
                                    sku
                                    price
                                    displayName
                                    metafield(namespace: "$app", key: "gd_b2b_price") {
                                        value
                                    }
                                }
                            }
                        }
                    }
                }
                pageInfo {
                    hasNextPage
                    hasPreviousPage
                    startCursor
                    endCursor
                }
            }
        }`,
        { variables: queryVariables }
    );

    const responseJson = await response.json();
    const products = responseJson.data?.products?.edges || [];
    const pageInfo = responseJson.data?.products?.pageInfo || {};
    const totalCount = responseJson.data?.productsCount?.count || 0;


    const initialAdjustments = {};
    products.forEach(({ node: product }) => {
        product.variants.edges.forEach(({ node: variant }) => {
            const metaValue = variant.metafield?.value;
            if (metaValue !== undefined && metaValue !== null) {
                initialAdjustments[variant.id] = parseFloat(metaValue);
            }
        });
    });


    const countResponse = await admin.graphql(
        `#graphql
        query {
            products(first: 250) {
                edges {
                    node {
                        variants(first: 100) {
                            edges {
                                node {
                                    id
                                    metafield(namespace: "$app", key: "gd_b2b_price") {
                                        value
                                    }
                                }
                            }
                        }
                    }
                }
                pageInfo {
                    hasNextPage
                }
            }
        }`
    );

    const countJson = await countResponse.json();
    let currentB2BCount = 0;
    
    countJson.data?.products?.edges.forEach(({ node: product }) => {
        product.variants.edges.forEach(({ node: variant }) => {
            const b2bValue = variant.metafield?.value;
            if (b2bValue !== undefined && b2bValue !== null && parseFloat(b2bValue) > 0) {
                currentB2BCount++;
            }
        });
    });



    return { 
        products, 
        pageInfo, 
        totalCount, 
        initialAdjustments,
        subscription: {
            planName: planName || "Free",
            variantLimit,
            currentUsage: currentB2BCount
        }
    };
};

export const action = async ({ request }) => {
    const { admin, session } = await authenticate.admin(request);
    const formData = await request.formData();

    const bulkUpdates = formData.get("bulkUpdates");
    if (bulkUpdates) {
        const updates = JSON.parse(bulkUpdates);


        const billingCheck = await admin.graphql(
            `#graphql
            query {
                currentAppInstallation {
                    activeSubscriptions {
                        name
                    }
                }
            }`
        );

        const billingJson = await billingCheck.json();
        const activeSubscriptions = billingJson.data?.currentAppInstallation?.activeSubscriptions || [];
        const planName = activeSubscriptions[0]?.name || null;
        const variantLimit = getVariantLimitForPlan(planName);


        const countResponse = await admin.graphql(
            `#graphql
            query {
                products(first: 250) {
                    edges {
                        node {
                            variants(first: 100) {
                                edges {
                                    node {
                                        id
                                        metafield(namespace: "$app", key: "gd_b2b_price") {
                                            value
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }`
        );

        const countJson = await countResponse.json();
        const currentVariantsWithB2B = new Set();
        
        countJson.data?.products?.edges.forEach(({ node: product }) => {
            product.variants.edges.forEach(({ node: variant }) => {
                const b2bValue = variant.metafield?.value;
                if (b2bValue !== undefined && b2bValue !== null && parseFloat(b2bValue) > 0) {
                    currentVariantsWithB2B.add(variant.id);
                }
            });
        });


        const deletions = [];
        const modifications = [];
        const additions = [];
        
        updates.forEach(update => {
            const valueToSet = (update.adjustment === '' || update.adjustment === null) ? null : String(update.adjustment);
            const numericValue = valueToSet !== null ? parseFloat(valueToSet) : 0;
            const isCurrentlySet = currentVariantsWithB2B.has(update.variantId);
            
            if (valueToSet === null || numericValue <= 0) {
                if (isCurrentlySet) {
                    deletions.push(update);
                }
            } else if (numericValue > 0 && isCurrentlySet) {
                modifications.push(update);
            } else if (numericValue > 0 && !isCurrentlySet) {
                additions.push(update);
            }
        });


        let currentCount = currentVariantsWithB2B.size;
        const slotsFreedByDeletions = deletions.length;
        const availableSlots = variantLimit !== null 
            ? Math.max(0, variantLimit - currentCount + slotsFreedByDeletions)
            : Infinity;


        const additionsToProcess = variantLimit !== null 
            ? additions.slice(0, availableSlots)
            : additions;
        const skippedAdditions = variantLimit !== null 
            ? additions.slice(availableSlots)
            : [];


        const processedUpdates = [...deletions, ...modifications, ...additionsToProcess];
        const skippedVariantIds = skippedAdditions.map(u => u.variantId);


        for (const update of processedUpdates) {
            const valueToSet = (update.adjustment === '' || update.adjustment === null) ? null : String(update.adjustment);

            if (valueToSet === null) {

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
                                    ownerId: update.variantId,
                                    namespace: "$app",
                                    key: "gd_b2b_price"
                                }
                            ]
                        }
                    }
                );
            } else {

                await admin.graphql(
                    `#graphql
                    mutation metaFieldSet($metafields: [MetafieldsSetInput!]!) {
                        metafieldsSet(metafields: $metafields) {
                            metafields {
                                id
                                key
                                value
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
                                    ownerId: update.variantId,
                                    namespace: "$app",
                                    key: "gd_b2b_price",
                                    value: valueToSet,
                                    type: "number_decimal"
                                }
                            ]
                        }
                    }
                );
            }
        }

        return { 
            success: true, 
            saved: processedUpdates.length,
            skipped: skippedAdditions.length,
            skippedVariantIds: skippedVariantIds
        };
    }

    return { success: true };
};

export default function B2BPricing() {
    const { products, pageInfo, totalCount, initialAdjustments, subscription } = useLoaderData();
    const shopify = useAppBridge();
    const fetcher = useFetcher();
    const navigate = useNavigate();
    const navigation = useNavigation();
    const [searchParams] = useSearchParams();
    const [priceAdjustments, setPriceAdjustments] = useState(initialAdjustments || {});
    const [selectedVariants, setSelectedVariants] = useState({});
    const [isStylesLoaded, setIsStylesLoaded] = useState(false);
    const [priceEntryTimestamps, setPriceEntryTimestamps] = useState({});


    const [searchTerm, setSearchTerm] = useState(searchParams.get("query") || "");

    const isSaving = fetcher.state !== "idle";
    const isNavigating = navigation.state !== "idle" && navigation.location?.pathname === "/app/subscription";


    useEffect(() => {

        const timer = setTimeout(() => {
            setIsStylesLoaded(true);
        }, 100);
        return () => clearTimeout(timer);
    }, []);


    useEffect(() => {
        if (fetcher.data?.success) {
            const { saved, skipped, skippedVariantIds } = fetcher.data;
            
            if (skipped > 0) {
                shopify.toast.show(`${saved} variant(s) saved. ${skipped} variant(s) skipped due to plan limit reached.`, { isError: true });
                

                if (skippedVariantIds && skippedVariantIds.length > 0) {
                    setPriceAdjustments(prev => {
                        const updated = { ...prev };
                        skippedVariantIds.forEach(id => {
                            delete updated[id];
                        });
                        return updated;
                    });
                    

                    setPriceEntryTimestamps(prev => {
                        const updated = { ...prev };
                        skippedVariantIds.forEach(id => {
                            delete updated[id];
                        });
                        return updated;
                    });
                }
            } else {
                shopify.toast.show(`Successfully updated ${saved} variant(s)`);
            }
        }
        if (fetcher.data?.error) {
            shopify.toast.show("Limit reached. Upgrade your plan.", { isError: true });
        }
    }, [fetcher.data, shopify]);



    useEffect(() => {
        if (initialAdjustments) {
            setPriceAdjustments(prev => ({
                ...prev,
                ...initialAdjustments
            }));
        }
    }, [initialAdjustments]);

    const currentPage = parseInt(searchParams.get("page") || "1", 10);


    useEffect(() => {
        const timer = setTimeout(() => {

            const currentQuery = searchParams.get("query") || "";
            if (searchTerm !== currentQuery) {
                const params = new URLSearchParams(searchParams);
                if (searchTerm) {
                    params.set("query", searchTerm);
                } else {
                    params.delete("query");
                }

                params.delete("cursor");
                params.delete("direction");
                params.set("page", "1");
                navigate(`?${params.toString()}`);
            }
        }, 500);

        return () => clearTimeout(timer);
    }, [searchTerm, navigate, searchParams]);


    const filteredProducts = products;

    const handlePriceAdjustmentChange = (variantId, value) => {

        if (value === '' || /^\d*\.?\d*$/.test(value)) {
            setPriceAdjustments(prev => ({
                ...prev,
                [variantId]: value
            }));
            

            if (value !== '') {
                setPriceEntryTimestamps(prev => ({
                    ...prev,
                    [variantId]: Date.now()
                }));
            }
        }
    };

    const handleKeyDown = (e) => {

        const allowedKeys = ['Backspace', 'Delete', 'Tab', 'Enter', 'ArrowLeft', 'ArrowRight', 'Home', 'End'];
        if (allowedKeys.includes(e.key) || e.ctrlKey || e.metaKey) return;


        if (e.key === '.') {
            if (e.target.value.includes('.')) e.preventDefault();
            return;
        }


        if (!/^\d$/.test(e.key)) {
            e.preventDefault();
        }
    };

    const handleVariantChange = (productId, variantId) => {
        setSelectedVariants(prev => ({
            ...prev,
            [productId]: variantId
        }));
    };

    const getSelectedVariant = (product) => {
        const productId = product.id;
        const selectedVariantId = selectedVariants[productId];

        if (selectedVariantId) {
            const variant = product.variants.edges.find(({ node }) => node.id === selectedVariantId);
            return variant?.node;
        }


        return product.variants.edges[0]?.node;
    };

    const handlePagination = (direction, cursor) => {
        const params = new URLSearchParams(searchParams);
        params.set("direction", direction);
        params.set("cursor", cursor);

        const newPage = direction === "next" ? currentPage + 1 : Math.max(1, currentPage - 1);
        params.set("page", newPage);

        navigate(`?${params.toString()}`);
    };

    const startItem = (currentPage - 1) * 10 + 1;

    const endItem = Math.min(startItem + products.length - 1, totalCount);


    const paginationLabel = totalCount > 0 ? `${startItem}-${endItem} of ${totalCount} products` : "No products";



    const handleBulkSave = () => {
        const updates = [];

        filteredProducts.forEach(({ node: product }) => {
            product.variants.edges.forEach(({ node: variant }) => {
                const currentVal = priceAdjustments[variant.id];
                const initialVal = initialAdjustments[variant.id];



                let hasChanged = false;

                const normalizedCurrent = currentVal === "" || currentVal === undefined ? null : parseFloat(currentVal);
                const normalizedInitial = initialVal === undefined ? null : initialVal;

                if (normalizedCurrent !== normalizedInitial) {

                    if (normalizedCurrent !== null && normalizedInitial !== null) {
                        if (Math.abs(normalizedCurrent - normalizedInitial) > 0.001) {
                            hasChanged = true;
                        }
                    } else {

                        hasChanged = true;
                    }
                }

                if (hasChanged) {
                    updates.push({
                        variantId: variant.id,
                        adjustment: currentVal,
                        timestamp: priceEntryTimestamps[variant.id] || 0
                    });
                }
            });
        });

        if (updates.length > 0) {

            updates.sort((a, b) => a.timestamp - b.timestamp);
            
            fetcher.submit(
                { bulkUpdates: JSON.stringify(updates) },
                { method: "POST" }
            );
        } else {
            shopify.toast.show("No changes to save on this page");
        }
    };

    return (
        <s-page heading="B2B Pricing">
            {isStylesLoaded && subscription.variantLimit !== null && subscription.currentUsage >= subscription.variantLimit - 3 && (
                <s-box paddingBlockStart="large">
                    <Banner
                        tone={
                            subscription.currentUsage >= subscription.variantLimit 
                                ? "critical" 
                                : "warning"
                        }
                    >
                        <InlineStack align="space-between" blockAlign="center">
                            <InlineStack gap="200" blockAlign="center">
                                <Text as="span" fontWeight="semibold">
                                    Plan: {subscription.planName}
                                </Text>
                                <Text as="span" variant="bodyMd">
                                    B2B Variants: {subscription.currentUsage}
                                    {subscription.variantLimit !== null ? `/${subscription.variantLimit}` : '/Unlimited'}
                                </Text>
                                {subscription.currentUsage >= subscription.variantLimit && (
                                    <Text as="span" variant="bodyMd" tone="critical">
                                        You've reached your limit
                                    </Text>
                                )}
                            </InlineStack>
                            {subscription.variantLimit !== null && (
                                <s-button 
                                    onClick={() => navigate('/app/subscription')} 
                                    variant="primary" 
                                    size="slim"
                                    loading={isNavigating}
                                >
                                    Upgrade Plan
                                </s-button>
                            )}
                        </InlineStack>
                    </Banner>
                </s-box>
            )}
            <s-box paddingBlockStart="large" paddingBlockEnd="large">
                <s-section>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                        <s-text variant="headingMd" as="h2">All Products</s-text>
                        <s-button variant="primary" onClick={handleBulkSave} loading={isSaving}>Save</s-button>
                    </div>
                    <s-stack gap="400" direction="block">

                        <s-text-field
                            label="Search products"
                            value={searchTerm}
                            onInput={(e) => setSearchTerm(e.target.value)}
                            placeholder="Search by product title..."
                            clearButton
                            onClearButtonClick={() => setSearchTerm("")}
                        />


                        {filteredProducts.length === 0 ? (
                            <s-box paddingBlockStart="large">
                                <div style={{ textAlign: 'center', padding: '60px 20px' }}>
                                    <s-text variant="headingLg" tone="subdued">
                                        No products found matching your search.
                                    </s-text>
                                </div>
                            </s-box>
                        ) : (
                            <>
                                <s-box paddingBlockStart="large">
                                    <s-table>
                                        <s-table-header-row>
                                            <s-table-header>Product</s-table-header>
                                            <s-table-header>SKU</s-table-header>
                                            <s-table-header>Original Price</s-table-header>
                                            <s-table-header>B2B Price</s-table-header>

                                        </s-table-header-row>
                                        <s-table-body>
                                            {filteredProducts.map(({ node: product }) => {
                                                const hasMultipleVariants = product.variants.edges.length > 1;
                                                const selectedVariant = getSelectedVariant(product);

                                                return (
                                                    <s-table-row key={product.id}>
                                                        <s-table-cell>
                                                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                                                {product.featuredImage && (
                                                                    <img
                                                                        src={product.featuredImage.url}
                                                                        alt={product.featuredImage.altText || product.title}
                                                                        style={{
                                                                            width: '40px',
                                                                            height: '40px',
                                                                            objectFit: 'cover',
                                                                            borderRadius: '4px'
                                                                        }}
                                                                    />
                                                                )}
                                                                {!product.featuredImage && (
                                                                    <div style={{
                                                                        width: '40px',
                                                                        height: '40px',
                                                                        backgroundColor: '#e0e0e0',
                                                                        borderRadius: '4px'
                                                                    }} />
                                                                )}
                                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                                                    <s-text variant="bodyMd" fontWeight="semibold">
                                                                        {product.title}
                                                                    </s-text>
                                                                    {hasMultipleVariants && (
                                                                        <s-text variant="bodySm" tone="subdued">
                                                                            {product.variants.edges.length} variants
                                                                        </s-text>
                                                                    )}
                                                                    {hasMultipleVariants && (
                                                                        <s-select
                                                                            label=""
                                                                            value={selectedVariant?.id || ''}
                                                                            onChange={(e) => handleVariantChange(product.id, e.target.value)}
                                                                        >
                                                                            {product.variants.edges.map(({ node: variant }) => (
                                                                                <s-option key={variant.id} value={variant.id}>
                                                                                    {variant.title !== 'Default Title' ? variant.title : variant.sku || 'No SKU'}
                                                                                </s-option>
                                                                            ))}
                                                                        </s-select>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        </s-table-cell>
                                                        <s-table-cell>
                                                            <s-text variant="bodyMd">
                                                                {selectedVariant?.sku || '-'}
                                                            </s-text>
                                                        </s-table-cell>
                                                        <s-table-cell>
                                                            <s-text variant="bodyMd">
                                                                $ {selectedVariant ? parseFloat(selectedVariant.price).toFixed(2) : '0.00'}
                                                            </s-text>
                                                        </s-table-cell>
                                                        <s-table-cell>
                                                            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', maxWidth: '200px' }}>
                                                                <s-text-field
                                                                    label=""
                                                                    value={priceAdjustments[selectedVariant.id] || ''}
                                                                    onInput={(e) => handlePriceAdjustmentChange(selectedVariant.id, e.target.value)}
                                                                    placeholder="0.00"
                                                                    prefix="$"
                                                                    type="number"
                                                                    step="0.01"
                                                                    onKeyDown={handleKeyDown}
                                                                    autoComplete="off"
                                                                />
                                                            </div>
                                                        </s-table-cell>

                                                    </s-table-row>
                                                );
                                            })}
                                        </s-table-body>
                                    </s-table>
                                </s-box>


                                {(pageInfo.hasNextPage || pageInfo.hasPreviousPage) && (
                                    <Pagination
                                        hasPrevious={pageInfo.hasPreviousPage}
                                        onPrevious={() => handlePagination("previous", pageInfo.startCursor)}
                                        hasNext={pageInfo.hasNextPage}
                                        onNext={() => handlePagination("next", pageInfo.endCursor)}
                                        type="table"
                                        label={paginationLabel}
                                    />
                                )}
                            </>
                        )}
                    </s-stack>
                </s-section>
            </s-box>
        </s-page>
    );
}
