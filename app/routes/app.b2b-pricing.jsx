import { useState, useEffect } from "react";
import { useLoaderData, useFetcher, useNavigate, useSearchParams } from "react-router";
import { authenticate } from "../shopify.server";
import { useAppBridge } from "@shopify/app-bridge-react";
import { Pagination } from "@shopify/polaris";

export const loader = async ({ request }) => {
    const { admin } = await authenticate.admin(request);
    const url = new URL(request.url);
    const cursor = url.searchParams.get("cursor");
    const direction = url.searchParams.get("direction");
    const query = url.searchParams.get("query") || ""; // Get search query

    let queryVariables = {
        first: 10,
        query: query, // Pass query to GraphQL
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

    return { products, pageInfo, totalCount };
};

export const action = async ({ request }) => {
    const { admin } = await authenticate.admin(request);

    const formData = await request.formData();
    const variantId = formData.get("variantId");
    const adjustment = formData.get("adjustment");

    // Here you would implement the price update logic
    // For now, just return success
    return { success: true, variantId, adjustment };
};

export default function B2BPricing() {
    const { products, pageInfo, totalCount } = useLoaderData();
    const shopify = useAppBridge();
    const fetcher = useFetcher();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const [priceAdjustments, setPriceAdjustments] = useState({});
    const [selectedVariants, setSelectedVariants] = useState({});

    // Initialize searchTerm from URL param
    const [searchTerm, setSearchTerm] = useState(searchParams.get("query") || "");

    const currentPage = parseInt(searchParams.get("page") || "1", 10);

    // Debounce search function
    useEffect(() => {
        const timer = setTimeout(() => {
            // Only navigate if the search term is different from what's in the URL
            // and we're not just on initial load with the same term
            const currentQuery = searchParams.get("query") || "";
            if (searchTerm !== currentQuery) {
                const params = new URLSearchParams(searchParams);
                if (searchTerm) {
                    params.set("query", searchTerm);
                } else {
                    params.delete("query");
                }
                // Reset pagination when searching
                params.delete("cursor");
                params.delete("direction");
                params.set("page", "1");
                navigate(`?${params.toString()}`);
            }
        }, 500); // 500ms debounce

        return () => clearTimeout(timer);
    }, [searchTerm, navigate, searchParams]);

    // Use products directly as they are now filtered by the server
    const filteredProducts = products;

    const handlePriceAdjustmentChange = (productId, value) => {
        setPriceAdjustments(prev => ({
            ...prev,
            [productId]: value
        }));
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

        // Default to first variant
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
    // When searching, total count might not be accurate for the filtered set, 
    // but for now we use totalCount from loader which is total shop products. 
    // Ideally GraphQL returns count of query matches but standard productsCount is total.
    // We'll stick to simple logic for now.
    const endItem = Math.min(startItem + products.length - 1, totalCount);

    // Note: totalCount from productsCount query usually returns TOTAL store products, 
    // not filtered count. For search results accurate counts, separate query is needed.
    // For specific search pagination label, we might just say "Page X" if count is unknown,
    // or rely on what we have.
    const paginationLabel = totalCount > 0 ? `${startItem}-${endItem} of ${totalCount} products` : "No products";

    const handleSaveAdjustment = (productId) => {
        const adjustment = priceAdjustments[productId];
        if (adjustment) {
            fetcher.submit(
                { variantId: selectedVariants[productId], adjustment },
                { method: "POST" }
            );
            shopify.toast.show(`Price adjustment saved for variant`);
        }
    };

    return (
        <s-page heading="B2B Pricing">
            <s-box paddingBlockStart="large" paddingBlockEnd="large">
                <s-section heading="All Products">
                    <s-stack gap="400" direction="block">
                        {/* Search Bar */}
                        <s-text-field
                            label="Search products"
                            value={searchTerm}
                            onInput={(e) => setSearchTerm(e.target.value)}
                            placeholder="Search by product title..."
                            clearButton
                            onClearButtonClick={() => setSearchTerm("")}
                        />

                        {/* Products Table */}
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
                                            <s-table-header>Base price</s-table-header>
                                            <s-table-header>Price adjustment</s-table-header>
                                            <s-table-header>Add Conditions</s-table-header>
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
                                                                $ {selectedVariant ? parseFloat(selectedVariant.price).toFixed(2) : '0.00'}
                                                            </s-text>
                                                        </s-table-cell>
                                                        <s-table-cell>
                                                            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', maxWidth: '200px' }}>
                                                                <s-text-field
                                                                    label=""
                                                                    value={priceAdjustments[product.id] || ''}
                                                                    onInput={(e) => handlePriceAdjustmentChange(product.id, e.target.value)}
                                                                    placeholder="0.00"
                                                                    prefix="$"
                                                                    type="number"
                                                                    step="0.01"
                                                                />
                                                            </div>
                                                        </s-table-cell>
                                                        <s-table-cell>
                                                            <s-button size="slim" onClick={() => shopify.toast.show('Conditions option coming soon')}>
                                                                + Add
                                                            </s-button>
                                                        </s-table-cell>
                                                    </s-table-row>
                                                );
                                            })}
                                        </s-table-body>
                                    </s-table>
                                </s-box>

                                {/* Pagination */}
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
