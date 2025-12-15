import { useState, useEffect, useRef } from "react";
import { useFetcher } from "react-router";
import { authenticate } from "../shopify.server";
import ExcelJS from "exceljs";
import { useAppBridge } from "@shopify/app-bridge-react";
import { Pagination, ProgressBar } from "@shopify/polaris";

export const loader = async ({ request }) => {
    await authenticate.admin(request);
    return null;
};

export const action = async ({ request }) => {
    const { admin } = await authenticate.admin(request);

    const formData = await request.formData();
    const dataString = formData.get("data");
    const rows = JSON.parse(dataString);

    const results = {
        total: rows.length,
        updated: 0,
        errors: [],
        failedRows: []
    };

    const processedCombinations = new Set();

    for (const row of rows) {
        try {
            // Flexible column matching (case-insensitive)
            const keys = Object.keys(row);
            const getCol = (name) => {
                const key = keys.find(k => k.toLowerCase() === name.toLowerCase());
                return key ? row[key] : undefined;
            };

            const skuRaw = getCol("SKU");
            if (!skuRaw || String(skuRaw).trim().toUpperCase() === "SKU") {
                continue;
            }
            const sku = String(skuRaw).trim();

            const priceRaw = getCol("Price");
            const compareAtPriceRaw = getCol("CompareAt Price");

            // Validate Price
            let newPrice = null;
            if (priceRaw !== undefined && priceRaw !== null && String(priceRaw).trim() !== "") {
                const parsed = parseFloat(priceRaw);
                if (isNaN(parsed)) {
                    results.errors.push(`Skipped SKU ${sku}: Invalid Price value '${priceRaw}'`);
                    results.failedRows.push({ ...row, "Error Reason": 'Invalid Price value' });
                    continue;
                }
                newPrice = parsed;
            }

            // Validate CompareAt Price
            let newCompareAtPrice = null;
            if (compareAtPriceRaw !== undefined && compareAtPriceRaw !== null && String(compareAtPriceRaw).trim() !== "") {
                const parsed = parseFloat(compareAtPriceRaw);
                if (isNaN(parsed)) {
                    results.errors.push(`Skipped SKU ${sku}: Invalid CompareAt Price value '${compareAtPriceRaw}'`);
                    results.failedRows.push({ ...row, "Error Reason": 'Invalid CompareAt Price value' });
                    continue;
                }
                newCompareAtPrice = parsed;
            }

            if (newPrice === null && newCompareAtPrice === null) {
                // Both fields missing or empty - count as treated/success
                results.updated++;
                continue;
            }

            // Check for duplicates in this batch
            if (processedCombinations.has(sku)) {
                results.errors.push(`Skipped SKU ${sku}: Duplicate SKU in file`);
                results.failedRows.push({ ...row, "Error Reason": 'Duplicate SKU in file' });
                continue;
            }
            processedCombinations.add(sku);

            // Find Variant by SKU
            const variantQuery = await admin.graphql(
                `#graphql
                query findVariantBySKU($query: String!) {
                    productVariants(first: 1, query: $query) {
                        edges {
                            node {
                                id
                                price
                                compareAtPrice
                                product {
                                    id
                                }
                            }
                        }
                    }
                }`,
                {
                    variables: {
                        query: `sku:${sku}`
                    }
                }
            );

            const variantResult = await variantQuery.json();
            const variant = variantResult.data?.productVariants?.edges[0]?.node;

            if (!variant) {
                results.errors.push(`Variant not found for SKU: ${sku}`);
                results.failedRows.push({ ...row, "Error Reason": 'Variant not found' });
                continue;
            }

            // Prepare Mutation Input
            const input = {
                id: variant.id
            };

            let needsUpdate = false;
            let skipReason = [];

            // Check Price
            if (newPrice !== null) {
                if (parseFloat(variant.price) !== newPrice) {
                    input.price = String(newPrice);
                    needsUpdate = true;
                } else {
                    skipReason.push("Price matches");
                }
            }

            // Check CompareAt Price
            if (newCompareAtPrice !== null) {
                // Handle case where existing compareAtPrice might be null
                const currentCompareAt = variant.compareAtPrice ? parseFloat(variant.compareAtPrice) : null;

                if (currentCompareAt !== newCompareAtPrice) {
                    input.compareAtPrice = String(newCompareAtPrice);
                    needsUpdate = true;
                } else {
                    skipReason.push("CompareAt Price matches");
                }
            }

            if (!needsUpdate) {
                // If data matches, count as success (updated) but don't call mutation
                results.updated++;
                continue;
            }

            // Execute Update
            const updateMutation = await admin.graphql(
                `#graphql
                mutation productVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
                    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
                        productVariants {
                            id
                            price
                            compareAtPrice
                        }
                        userErrors {
                            field
                            message
                        }
                    }
                }`,
                {
                    variables: {
                        productId: variant.product.id,
                        variants: [input]
                    }
                }
            );

            const updateResult = await updateMutation.json();

            if (updateResult.data?.productVariantsBulkUpdate?.userErrors?.length > 0) {
                const errorMsg = updateResult.data.productVariantsBulkUpdate.userErrors[0].message;
                results.errors.push(`Error updating SKU ${sku}: ${errorMsg}`);
                results.failedRows.push({ ...row, "Error Reason": errorMsg });
            } else {
                results.updated++;
            }

        } catch (error) {
            results.errors.push(`Error processing SKU ${row["SKU"]}: ${error.message}`);
            results.failedRows.push({ ...row, "Error Reason": error.message });
        }
    }

    return { success: true, results };
};

export default function PriceUpdate() {
    const shopify = useAppBridge();
    const fetcher = useFetcher();
    const [file, setFile] = useState(null);
    const [parsedData, setParsedData] = useState(null);
    const [progress, setProgress] = useState(0);
    const [isProgressVisible, setIsProgressVisible] = useState(false);
    const fileInputRef = useRef(null);

    const [failedPage, setFailedPage] = useState(1);
    const failedRowsPerPage = 10;

    const isLoading = fetcher.state === "submitting" || fetcher.state === "loading";

    useEffect(() => {
        if (isLoading) {
            setIsProgressVisible(true);
            setProgress(0);

            const rowCount = parsedData ? parsedData.length : 0;
            const estimatedTimeMs = Math.max(rowCount * 500, 2000);
            const intervalMs = 100;

            const totalSteps = estimatedTimeMs / intervalMs;
            const linearIncrement = 90 / totalSteps;

            const interval = setInterval(() => {
                setProgress((prev) => {
                    if (prev < 90) {
                        return Math.min(prev + linearIncrement, 90);
                    } else {
                        const target = 99;
                        const remaining = target - prev;
                        return prev + Math.max(remaining * 0.01, 0.01);
                    }
                });
            }, intervalMs);
            return () => clearInterval(interval);
        } else if (isProgressVisible && !isLoading) {
            setProgress(100);
        }
    }, [isLoading, isProgressVisible, parsedData]);

    useEffect(() => {
        if (!isLoading && fetcher.data?.results && isProgressVisible) {
            const timeout = setTimeout(() => {
                setIsProgressVisible(false);
            }, 300);
            return () => clearTimeout(timeout);
        }
    }, [isLoading, fetcher.data?.results, isProgressVisible]);

    const handleFileChange = (e) => {
        const selectedFile = e.target.files[0];
        if (selectedFile) {
            setFile(selectedFile);
            setFailedPage(1);

            const reader = new FileReader();
            reader.onload = async (event) => {
                const buffer = event.target.result;
                const workbook = new ExcelJS.Workbook();
                await workbook.xlsx.load(buffer);

                const worksheet = workbook.worksheets[0];
                const jsonData = [];

                const headers = [];
                worksheet.getRow(1).eachCell((cell, colNumber) => {
                    headers[colNumber] = cell.value;
                });

                // Validate mandatory headers
                const headerValues = Object.values(headers).map(h => String(h).trim().toLowerCase());
                const missingColumns = [];
                if (!headerValues.includes("sku")) missingColumns.push("SKU");
                if (!headerValues.includes("price")) missingColumns.push("Price");

                if (missingColumns.length > 0) {
                    const errorMsg = `Error: '${missingColumns.join("' and '")}' column${missingColumns.length > 1 ? "s are" : " is"} missing.`;
                    shopify.toast.show(errorMsg, { isError: true });
                    setFile(null);
                    if (fileInputRef.current) fileInputRef.current.value = "";
                    return;
                }

                worksheet.eachRow((row, rowNumber) => {
                    if (rowNumber > 1) {
                        const rowData = {};
                        row.eachCell((cell, colNumber) => {
                            if (headers[colNumber]) {
                                rowData[headers[colNumber]] = cell.value;
                            }
                        });

                        // Check for SKU column (case-insensitive key match)
                        const keys = Object.keys(rowData);
                        const skuKey = keys.find(k => k.toLowerCase() === "sku");

                        if (skuKey && rowData[skuKey] && String(rowData[skuKey]).trim() !== "") {
                            jsonData.push(rowData);
                        }
                    }
                });

                setParsedData(jsonData);
                shopify.toast.show(`File loaded: ${jsonData.length} rows. Starting update...`);

                fetcher.submit(
                    {
                        data: JSON.stringify(jsonData)
                    },
                    { method: "POST" }
                );
            };
            reader.readAsArrayBuffer(selectedFile);
        }
    };

    const handleButtonClick = () => {
        if (fileInputRef.current) {
            fileInputRef.current.click();
        }
    };

    useEffect(() => {
        if (fetcher.data?.success && fetcher.state === "idle") {
            const { results } = fetcher.data;
            shopify.toast.show(`Update complete: ${results.updated} updated, ${results.errors.length} errors`);
            setFile(null);
            setParsedData(null);
            if (fileInputRef.current) {
                fileInputRef.current.value = "";
            }
        }
    }, [fetcher.data, fetcher.state, shopify]);

    return (
        <s-page heading="Bulk Price Update">
            <s-box paddingBlockStart="large">
                <s-section
                    heading="Upload an Excel file with SKU, Price, and CompareAt Price columns.">

                    <input
                        ref={fileInputRef}
                        type="file"
                        accept=".xlsx,.xls"
                        onChange={handleFileChange}
                        style={{ display: 'none' }}
                    />

                    <s-button
                        variant="primary"
                        onClick={handleButtonClick}
                        loading={isLoading ? "true" : undefined}
                        paddingBlock="large"
                    >
                        Import Prices
                    </s-button>
                </s-section>
            </s-box>

            {isProgressVisible && (
                <div style={{
                    position: 'fixed',
                    top: '50%',
                    left: '50%',
                    transform: 'translate(-50%, -50%)',
                    zIndex: 1000,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '16px',
                    width: '300px'
                }}>
                    <div style={{ width: '100%' }}>
                        <ProgressBar progress={Math.floor(progress)} size="small" />
                    </div>
                    <s-text variant="bodyLg">Updating prices...</s-text>
                    <s-div className="ProcessMain">
                        <s-text className="ProcessInner"></s-text>
                    </s-div>
                </div>
            )}

            {!isLoading && fetcher.data?.results && !isProgressVisible && (
                <>
                    <s-box paddingBlockStart="large">
                        <s-section heading="Update Results">
                            <s-stack gap="200" direction="block">
                                <s-text as="p">Total rows: {fetcher.data.results.total}</s-text>
                                <s-text as="p">Successfully updated: {fetcher.data.results.updated}</s-text>
                                <s-text as="p">Errors: {fetcher.data.results.errors.length}</s-text>
                            </s-stack>
                        </s-section>
                    </s-box>

                    {fetcher.data.results.failedRows?.length > 0 && (
                        <s-box paddingBlockStart="large">
                            <s-section heading={`❌ Failed Rows (${fetcher.data.results.failedRows.length})`}>
                                <s-table>
                                    <s-table-header-row>
                                        {Object.keys(fetcher.data.results.failedRows[0] || {}).map((key) => (
                                            <s-table-header key={key}>{key}</s-table-header>
                                        ))}
                                    </s-table-header-row>
                                    <s-table-body>
                                        {fetcher.data.results.failedRows
                                            .slice((failedPage - 1) * failedRowsPerPage, failedPage * failedRowsPerPage)
                                            .map((row, index) => (
                                                <s-table-row key={index}>
                                                    {Object.keys(fetcher.data.results.failedRows[0] || {}).map((key, cellIndex) => (
                                                        <s-table-cell key={cellIndex}>
                                                            {row[key]?.toString() || '-'}
                                                        </s-table-cell>
                                                    ))}
                                                </s-table-row>
                                            ))}
                                    </s-table-body>
                                </s-table>
                                {fetcher.data.results.failedRows.length > failedRowsPerPage && (
                                    <Pagination
                                        hasPrevious={failedPage > 1}
                                        onPrevious={() => setFailedPage(failedPage - 1)}
                                        hasNext={failedPage < Math.ceil(fetcher.data.results.failedRows.length / failedRowsPerPage)}
                                        onNext={() => setFailedPage(failedPage + 1)}
                                        type="table"
                                        label={`${((failedPage - 1) * failedRowsPerPage) + 1}-${Math.min(failedPage * failedRowsPerPage, fetcher.data.results.failedRows.length)} of ${fetcher.data.results.failedRows.length}`}
                                    />
                                )}
                            </s-section>
                        </s-box>
                    )}
                </>
            )}
        </s-page>
    );
}
