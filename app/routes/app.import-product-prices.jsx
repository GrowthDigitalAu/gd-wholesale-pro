import { useState, useEffect, useRef } from "react";
import { useFetcher } from "react-router";
import { authenticate } from "../shopify.server";
import ExcelJS from "exceljs";
import { useAppBridge } from "@shopify/app-bridge-react";
import { Pagination, ProgressBar } from "@shopify/polaris";
import { getVariantLimitForPlan } from "../utils/subscription";

export const loader = async ({ request }) => {
    const { admin } = await authenticate.admin(request);
    const url = new URL(request.url);
    const checkStatus = url.searchParams.get("checkStatus");
    const operationId = url.searchParams.get("operationId");


    if (checkStatus === "true" && operationId) {
        const response = await admin.graphql(
            `#graphql
            query($id: ID!) {
                node(id: $id) {
                    ... on BulkOperation {
                        id
                        status
                        objectCount
                        url
                    }
                }
            }`,
            { variables: { id: operationId } }
        );

        const data = await response.json();
        const bulkOperation = data.data?.node;

        if (!bulkOperation) {
            return { success: false, status: "NONE", operationId };
        }

        if (bulkOperation.status === "COMPLETED") {
             let bulkErrors = [];
             
             if (bulkOperation.url) {
                try {
                    const fileResponse = await fetch(bulkOperation.url);
                    const text = await fileResponse.text();
                    const lines = text.split("\n").filter(line => line.trim() !== "");
                    lines.forEach(line => {
                        const result = JSON.parse(line);
                        const userErrors = result.productVariantsBulkUpdate?.userErrors || [];
                        if (userErrors.length > 0) {
                             bulkErrors.push(userErrors[0].message);
                        }
                    });
                } catch (e) {
                }
             }
             
             return { success: true, status: "COMPLETED", bulkResults: { errors: bulkErrors }, operationId };

        } else if (bulkOperation.status === "RUNNING" || bulkOperation.status === "CREATED") {
             return { success: true, status: "RUNNING", progress: bulkOperation.objectCount, operationId };
        } else {
             return { success: false, status: bulkOperation.status, operationId };
        }
    }

    return { success: true };
};

export const action = async ({ request }) => {
    const { admin } = await authenticate.admin(request);
    const formData = await request.formData();
    const dataString = formData.get("data");
    const headersString = formData.get("headers");
    const rows = JSON.parse(dataString);
    const headersFromFrontend = headersString ? JSON.parse(headersString) : null;

    const results = {
        total: rows.length,
        updated: 0,
        updatedPrice: 0,
        updatedCompareAt: 0,
        updatedB2B: 0,
        errors: [],
        failedRows: [],
        skippedRows: [],
        updatedRows: [],
        limitReachedCount: 0,
        bulkOperationId: null
    };

    let allColumns = [];
    if (headersFromFrontend && headersFromFrontend.length > 0) {
        allColumns = headersFromFrontend;
    } else {
        const allColumnsSet = new Set();
        rows.forEach(row => {
            Object.keys(row).forEach(key => {
                if (!allColumnsSet.has(key)) {
                    allColumnsSet.add(key);
                    allColumns.push(key);
                }
            });
        });
    }

    const normalizeRow = (row, additionalFields = {}) => {
        const normalized = {};
        allColumns.forEach(col => {
            normalized[col] = row[col] !== undefined ? row[col] : "";
        });
        Object.keys(additionalFields).forEach(key => {
            normalized[key] = additionalFields[key];
        });
        return normalized;
    };

    let skuMap = new Map();
    
    let hasNextPage = true;
    let endCursor = null;

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

    while (hasNextPage) {
        const query = `#graphql
        query getPriceData($after: String) {
            productVariants(first: 250, after: $after) {
                pageInfo { hasNextPage endCursor }
                edges {
                    node {
                        id
                        sku
                        price
                        compareAtPrice
                        metafield(namespace: "$app", key: "gd_b2b_price") {
                            id
                            value
                        }
                        product {
                            id
                        }
                    }
                }
            }
        }`;
        
        const res = await admin.graphql(query, { variables: { after: endCursor } });
        const data = await res.json();
        
        data.data?.productVariants?.edges.forEach(edge => {
            const node = edge.node;
            if (node.sku) {
                skuMap.set(node.sku.toLowerCase(), {
                    id: node.id,
                    productId: node.product.id,
                    price: parseFloat(node.price),
                    compareAtPrice: node.compareAtPrice ? parseFloat(node.compareAtPrice) : null,
                    b2bPrice: node.metafield?.value !== undefined && node.metafield?.value !== null ? parseFloat(node.metafield.value) : null,
                    b2bMetafieldId: node.metafield?.id || null
                });
            }
        });
        
        hasNextPage = data.data?.productVariants?.pageInfo?.hasNextPage;
        endCursor = data.data?.productVariants?.pageInfo?.endCursor;
    }

    let currentB2BCount = 0;
    skuMap.forEach(variant => {
        if (variant.b2bPrice !== null && variant.b2bPrice > 0) {
            currentB2BCount++;
        }
    });


    const processedCombinations = new Set();
    const bulkUpdates = [];

    const hasB2BPriceColumn = rows.length > 0 && rows[0].hasOwnProperty("B2B Price");
    
    let sortedRows = rows;
    if (hasB2BPriceColumn) {
        sortedRows = [...rows].sort((a, b) => {
            const aB2BRaw = a["B2B Price"];
            const bB2BRaw = b["B2B Price"];
            
            const aB2BValue = aB2BRaw !== undefined && aB2BRaw !== null && String(aB2BRaw).trim() !== "" && String(aB2BRaw).trim().toLowerCase() !== "null" 
                ? parseFloat(aB2BRaw) 
                : null;
            const bB2BValue = bB2BRaw !== undefined && bB2BRaw !== null && String(bB2BRaw).trim() !== "" && String(bB2BRaw).trim().toLowerCase() !== "null"
                ? parseFloat(bB2BRaw) 
                : null;
            
            const aIsDeletion = aB2BValue === null || aB2BValue <= 0;
            const bIsDeletion = bB2BValue === null || bB2BValue <= 0;
            
            if (aIsDeletion && !bIsDeletion) return -1;
            if (!aIsDeletion && bIsDeletion) return 1;
            return 0;
        });
    }

    for (const row of sortedRows) {
        try {
            if (!row["SKU"] || row["SKU"] === "SKU") continue;

            const sku = String(row["SKU"]).trim();
            const skuKey = sku.toLowerCase();
            
            const priceRaw = row["Price"];
            const compareAtPriceRaw = row["CompareAt Price"];
            const b2bPriceRaw = row["B2B Price"];

            let newPrice = null;
            if (priceRaw !== undefined && priceRaw !== null && String(priceRaw).trim() !== "") {
                const parsed = parseFloat(priceRaw);
                if (isNaN(parsed)) {
                    results.errors.push(`Skipped SKU ${sku}: Invalid Price value '${priceRaw}'`);
                    results.failedRows.push(normalizeRow(row, { "Error Reason": 'Invalid Price value' }));
                    continue;
                }
                newPrice = parsed;
            }

            let newCompareAtPrice = null;
            let shouldClearCompareAt = false;
            
            if (compareAtPriceRaw !== undefined && compareAtPriceRaw !== null) {
                const trimmed = String(compareAtPriceRaw).trim();
                
                if (trimmed.toLowerCase() === "null") {
                    shouldClearCompareAt = true;
                } else if (trimmed !== "") {
                    const parsed = parseFloat(trimmed);
                    if (isNaN(parsed)) {
                        results.errors.push(`Skipped SKU ${sku}: Invalid CompareAt Price value '${compareAtPriceRaw}'`);
                        results.failedRows.push(normalizeRow(row, { "Error Reason": 'Invalid CompareAt Price value' }));
                        continue;
                    }
                    newCompareAtPrice = parsed;
                }
            }

            let newB2BPrice = null;
            let shouldClearB2B = false;
            
            if (b2bPriceRaw !== undefined && b2bPriceRaw !== null) {
                const trimmed = String(b2bPriceRaw).trim();
                
                if (trimmed.toLowerCase() === "null") {
                    shouldClearB2B = true;
                    newB2BPrice = 0;
                } else if (trimmed !== "") {
                    const parsed = parseFloat(trimmed);
                    if (!isNaN(parsed)) {
                        newB2BPrice = parsed;
                    }
                }
            }


            if (processedCombinations.has(skuKey)) {
                results.errors.push(`Skipped SKU ${sku}: Duplicate SKU in file`);
                results.failedRows.push(normalizeRow(row, { "Error Reason": 'Duplicate SKU in file' }));
                continue;
            }
            processedCombinations.add(skuKey);

            // Lookup variant
            const variantData = skuMap.get(skuKey);
            
            if (!variantData) {
                results.errors.push(`Variant not found for SKU: ${sku}`);
                results.failedRows.push(normalizeRow(row, { "Error Reason": 'Variant not found' }));
                continue;
            }

            const variantInput = {
                id: variantData.id
            };

            let needsUpdate = false;
            let priceUpdated = false;
            let compareAtUpdated = false;
            let b2bUpdated = false;

            if (newPrice !== null && variantData.price !== newPrice) {
                variantInput.price = String(newPrice);
                needsUpdate = true;
                priceUpdated = true;
            }

            if (shouldClearCompareAt) {
                if (variantData.compareAtPrice !== null) {
                    variantInput.compareAtPrice = null;
                    needsUpdate = true;
                    compareAtUpdated = true;
                }
            } else if (newCompareAtPrice !== null && variantData.compareAtPrice !== newCompareAtPrice) {
                variantInput.compareAtPrice = String(newCompareAtPrice);
                needsUpdate = true;
                compareAtUpdated = true;
            }

            if (newB2BPrice !== null && variantData.b2bPrice !== newB2BPrice) {
                if (variantData.b2bMetafieldId) {
                    variantInput.metafields = [{
                        id: variantData.b2bMetafieldId,
                        value: String(newB2BPrice),
                        type: "number_decimal"
                    }];
                } else {
                    variantInput.metafields = [{
                        namespace: "$app",
                        key: "gd_b2b_price",
                        value: String(newB2BPrice),
                        type: "number_decimal"
                    }];
                }
                needsUpdate = true;
                b2bUpdated = true;
            }

            if (!needsUpdate) {
                results.skippedRows.push(normalizeRow(row, { "Reason": 'Prices already match' }));
                continue;
            }

            if (b2bUpdated) {
                const oldB2BPrice = variantData.b2bPrice;
                const isAddingMeaningfulB2BPrice = (oldB2BPrice === null || oldB2BPrice <= 0) && newB2BPrice > 0;
                const isRemovingMeaningfulB2BPrice = (oldB2BPrice !== null && oldB2BPrice > 0) && (newB2BPrice === null || newB2BPrice <= 0);
                
                if (isRemovingMeaningfulB2BPrice) {
                    currentB2BCount--;
                }
                
                if (isAddingMeaningfulB2BPrice && variantLimit !== null) {
                    const availableSlots = variantLimit - currentB2BCount;
                    
                    if (availableSlots <= 0) {
                        results.errors.push(`SKU ${sku}: Plan limit reached. Your ${planName || 'Free'} plan allows ${variantLimit} variants with B2B prices.`);
                        results.failedRows.push(normalizeRow(row, { "Error Reason": 'Plan limit reached' }));
                        results.limitReachedCount++;
                        continue;
                    }
                    
                    currentB2BCount++;
                }
            }

            if (priceUpdated) results.updatedPrice++;
            if (compareAtUpdated) results.updatedCompareAt++;
            if (b2bUpdated) results.updatedB2B++;

            // Track which columns were updated for this row
            const updatedColumns = [];
            if (priceUpdated) updatedColumns.push('Price');
            if (compareAtUpdated) updatedColumns.push('CompareAt Price');
            if (b2bUpdated) updatedColumns.push('B2B Price');
            
            // Add to updated rows with reason
            results.updatedRows.push(normalizeRow(row, { 
                "Reason": `Updated: ${updatedColumns.join(', ')}` 
            }));

            bulkUpdates.push({
                productId: variantData.productId,
                variantInput: variantInput
            });

        } catch (error) {
            results.errors.push(`Error processing SKU ${row["SKU"]}: ${error.message}`);
            results.failedRows.push(normalizeRow(row, { "Error Reason": error.message }));
        }
    }



    if (bulkUpdates.length === 0) {
        return { success: true, results };
    }

    const productGroups = new Map();
    bulkUpdates.forEach(update => {
        if (!productGroups.has(update.productId)) {
            productGroups.set(update.productId, []);
        }
        productGroups.get(update.productId).push(update.variantInput);
    });

    const jsonlLines = [];
    for (const [productId, variants] of productGroups) {
        jsonlLines.push(JSON.stringify({
            productId: productId,
            variants: variants
        }));
    }

    const { stagedUploadsCreate, userErrors: stageErrors } = await (await admin.graphql(`#graphql
    mutation stagedUploadsCreate($input: [StagedUploadInput!]!) {
        stagedUploadsCreate(input: $input) {
            stagedTargets { url resourceUrl parameters { name value } }
            userErrors { field message }
        }
    }`, {
        variables: {
            input: [{
                filename: "price_updates.jsonl",
                mimeType: "text/jsonl",
                httpMethod: "POST",
                resource: "BULK_MUTATION_VARIABLES"
            }]
        }
    })).json().then(r => r.data || {});

    if (stageErrors?.length > 0 || stagedUploadsCreate?.userErrors?.length > 0) {
        const msg = stageErrors?.[0]?.message || stagedUploadsCreate?.userErrors?.[0]?.message;
        results.errors.push("Failed to create upload target: " + msg);
        return { success: true, results };
    }

    const target = stagedUploadsCreate?.stagedTargets?.[0];
    if (target) {
        const formData = new FormData();
        const keyParam = target.parameters.find(p => p.name === "key");
        const uploadPath = keyParam?.value;

        target.parameters.forEach(p => formData.append(p.name, p.value));
        formData.append("file", new Blob([jsonlLines.join("\n")], { type: "text/jsonl" }));

        const uploadRes = await fetch(target.url, { method: "POST", body: formData });
        if (!uploadRes.ok) {
             results.errors.push(`Upload failed: ${uploadRes.statusText}`);
             return { success: true, results };
        }

        const bulkRes = await admin.graphql(`#graphql
        mutation bulkOperationRunMutation($mutation: String!, $stagedUploadPath: String!) {
            bulkOperationRunMutation(mutation: $mutation, stagedUploadPath: $stagedUploadPath) {
                bulkOperation { id }
                userErrors { field message }
            }
        }`, {
            variables: {
                mutation: `mutation productVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
                    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
                        productVariants { id }
                        userErrors { field message }
                    }
                }`,
                stagedUploadPath: uploadPath
            }
        });
        
        const bulkData = await bulkRes.json();
        if (bulkData.data?.bulkOperationRunMutation?.userErrors?.length > 0) {
             results.errors.push("Bulk Mutation Error: " + bulkData.data.bulkOperationRunMutation.userErrors[0].message);
        } else {
             const opId = bulkData.data?.bulkOperationRunMutation?.bulkOperation?.id;
             console.log("Bulk Op Started:", opId, "Upload Key:", uploadPath);
             
             if (opId) {
                 results.bulkOperationId = opId;
                 // Store how many variants we queued for update
                 results.expectedUpdateCount = bulkUpdates.length;
             } else {
                 results.errors.push("Failed to trigger backend bulk operation (No ID returned)");
             }
        }
    } else {
        results.errors.push("Failed to get upload target URL");
    }

    return { success: true, results };
};

export default function ImportProductPrices() {
    const shopify = useAppBridge();
    const fetcher = useFetcher();
    const pollFetcher = useFetcher(); 
    
    const [file, setFile] = useState(null);
    const [parsedData, setParsedData] = useState(null);
    const [progress, setProgress] = useState(0);
    const [isProgressVisible, setIsProgressVisible] = useState(false);
    const fileInputRef = useRef(null);

    const [validatedResults, setValidatedResults] = useState(null);
    const [finalResults, setFinalResults] = useState(null);

    const [failedPage, setFailedPage] = useState(1);
    const failedRowsPerPage = 10;
    const [skippedPage, setSkippedPage] = useState(1);
    const skippedRowsPerPage = 10;
    const [updatedPage, setUpdatedPage] = useState(1);
    const updatedRowsPerPage = 10;

    const isLoading = fetcher.state === "submitting" || fetcher.state === "loading";

    const handleFileChange = (e) => {
        const selectedFile = e.target.files[0];
        if (selectedFile) {
            setFile(selectedFile);
            setFailedPage(1);
            setSkippedPage(1);
            setUpdatedPage(1);
            setValidatedResults(null); 
            setFinalResults(null);

            e.target.value = ""; 

            const reader = new FileReader();
            reader.onload = async (event) => {
                const buffer = event.target.result;
                const workbook = new ExcelJS.Workbook();
                await workbook.xlsx.load(buffer);
                const worksheet = workbook.worksheets[0];
                const jsonData = [];
                const headers = [];
                worksheet.getRow(1).eachCell((cell, colNumber) => {
                   headers[colNumber] = cell.value ? String(cell.value).trim() : "";
                });
                worksheet.eachRow((row, rowNumber) => {
                    if (rowNumber > 1) {
                        const rowData = {};
                        row.eachCell((cell, colNumber) => {
                            if (headers[colNumber]) rowData[headers[colNumber]] = cell.value;
                        });
                        if (rowData["SKU"] && String(rowData["SKU"]).trim() !== "") {
                            jsonData.push(rowData);
                        }
                    }
                });
                setParsedData(jsonData);
                shopify.toast.show(`File loaded: ${jsonData.length} rows. Starting import...`, { duration: 5000 });
                setIsProgressVisible(true);
                setProgress(10);
                // Send headers to preserve column order
                const headersInOrder = headers.filter(h => h); // Remove empty entries
                fetcher.submit({ 
                    data: JSON.stringify(jsonData),
                    headers: JSON.stringify(headersInOrder)
                }, { method: "POST" });
            };
            reader.readAsArrayBuffer(selectedFile);
        }
    };

    const handleButtonClick = () => {
        if (fileInputRef.current) fileInputRef.current.click();
    };

    // --- HANDLE ACTION RESPONSE ---
    useEffect(() => {
        if (fetcher.data?.success && fetcher.state === "idle") {
            const res = fetcher.data.results;
            setValidatedResults(res);

            if (res.bulkOperationId) {
                pollFetcher.load(`/app/import-product-prices?checkStatus=true&operationId=${res.bulkOperationId}`);
            } else {
                setFinalResults(res); 
                setProgress(100);
                setTimeout(() => setIsProgressVisible(false), 2000);
                shopify.toast.show(`Import complete.`, { duration: 5000 });
            }
        }
    }, [fetcher.data, fetcher.state]);

    // --- POLLING ---
    useEffect(() => {
        if (validatedResults?.bulkOperationId) {
             const opId = validatedResults.bulkOperationId;
             if (pollFetcher.data && pollFetcher.data.operationId) {
                  if (pollFetcher.data.operationId !== opId) return;

                  if (pollFetcher.data.status === "RUNNING" || pollFetcher.data.status === "CREATED") {
                       const timer = setTimeout(() => {
                           pollFetcher.load(`/app/import-product-prices?checkStatus=true&operationId=${opId}`);
                       }, 2000);
                       return () => clearTimeout(timer);
                  } else if (pollFetcher.data.status === "COMPLETED") {
                       const bulkRes = pollFetcher.data.bulkResults || { errors: [] };
                       
                       const merged = {
                           ...validatedResults,
                           updated: validatedResults.expectedUpdateCount || 0,
                           updatedPrice: validatedResults.updatedPrice || 0,
                           updatedCompareAt: validatedResults.updatedCompareAt || 0,
                           updatedB2B: validatedResults.updatedB2B || 0,
                           errors: [...validatedResults.errors, ...bulkRes.errors]
                       };
                       setFinalResults(merged);
                       setProgress(100);
                       
                       const breakdown = [];
                       if (merged.updatedPrice > 0) breakdown.push(`${merged.updatedPrice} Price`);
                       if (merged.updatedCompareAt > 0) breakdown.push(`${merged.updatedCompareAt} CompareAt`);
                       if (merged.updatedB2B > 0) breakdown.push(`${merged.updatedB2B} B2B`);
                       const breakdownText = breakdown.length > 0 ? ` (${breakdown.join(', ')})` : '';
                       
                       shopify.toast.show(`Import complete. ${merged.updated} products updated${breakdownText}.`, { duration: 5000 });
                       setTimeout(() => setIsProgressVisible(false), 2000);
                  } else if (pollFetcher.data.status === "FAILED") {
                       shopify.toast.show("Background update failed.", { duration: 5000 });
                       setIsProgressVisible(false);
                  }
             }
        }
    }, [pollFetcher.data, validatedResults]);

    // --- PROGRESS UI ---
    useEffect(() => {
        if (isLoading) {
             const interval = setInterval(() => {
                setProgress((prev) => {
                    if (prev < 30) return prev + 2;
                    if (prev < 60) return prev + 0.5;
                    if (prev < 90) return prev + 0.05;
                    return prev;
                });
            }, 100);
            return () => clearInterval(interval);
        } else if (validatedResults?.bulkOperationId && !finalResults) {
             const interval = setInterval(() => {
                setProgress((prev) => {
                     if (prev < 80) return prev + 1;
                     if (prev < 95) return prev + 0.1; 
                     return prev;
                });
            }, 500);
            return () => clearInterval(interval);
        }
    }, [isLoading, validatedResults, finalResults]);

    const displayResults = finalResults || validatedResults;

    return (
        <s-page heading="Import Product Prices">
            <s-box paddingBlockStart="large">
                <s-section heading="Upload an Excel file with SKU, Price, CompareAt Price, and B2B Price columns.">
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
                        loading={(isLoading || (validatedResults?.bulkOperationId && !finalResults)) ? "true" : undefined}
                        paddingBlock="large"
                    >
                        Import Product Prices
                    </s-button>
                </s-section>
            </s-box>

            {isProgressVisible && (
                <div style={{
                    position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
                    zIndex: 1000, display: 'flex', flexDirection: 'column', alignItems: 'center',
                    gap: '16px', width: '300px'
                }}>
                    <ProgressBar progress={progress} size="small" />
                    <s-text variant="bodyLg">
                         {validatedResults?.bulkOperationId && !finalResults ? "Processing price updates..." : "Importing product prices..."}
                    </s-text>
                </div>
            )}

            {displayResults && !isProgressVisible && (
                <>
                    <s-box paddingBlockStart="large">
                        <s-section heading="Import Results">
                            <s-stack gap="200" direction="block">
                                <s-text as="p">Total rows: {displayResults.total}</s-text>
                                <s-text as="p">Successfully updated Price: {displayResults.updatedPrice || 0}</s-text>
                                <s-text as="p">Successfully updated CompareAt Price: {displayResults.updatedCompareAt || 0}</s-text>
                                <s-text as="p">Successfully updated B2B Price: {displayResults.updatedB2B || 0}</s-text>
                                <s-text as="p">Errors: {displayResults.errors.length}</s-text>
                                {displayResults.limitReachedCount > 0 && (
                                    <s-text as="p" tone="critical">Plan limit reached: {displayResults.limitReachedCount} row(s) failed due to subscription limit</s-text>
                                )}
                            </s-stack>
                        </s-section>
                    </s-box>

                    {displayResults.updatedRows?.length > 0 && (
                        <s-box paddingBlockStart="large">
                            <s-section heading="✅ Updated Rows">
                                <s-table>
                                    <s-table-header-row>
                                        {Object.keys(displayResults.updatedRows[0] || {}).map((key) => (
                                            <s-table-header key={key}>{key}</s-table-header>
                                        ))}
                                    </s-table-header-row>
                                    <s-table-body>
                                        {displayResults.updatedRows
                                            .slice((updatedPage - 1) * updatedRowsPerPage, updatedPage * updatedRowsPerPage)
                                            .map((row, index) => (
                                                <s-table-row key={index}>
                                                    {Object.keys(displayResults.updatedRows[0] || {}).map((key, cellIndex) => (
                                                        <s-table-cell key={cellIndex}>
                                                            {row[key]?.toString() || '-'}
                                                        </s-table-cell>
                                                    ))}
                                                </s-table-row>
                                            ))}
                                    </s-table-body>
                                </s-table>
                                {displayResults.updatedRows.length > updatedRowsPerPage && (
                                    <Pagination
                                        hasPrevious={updatedPage > 1}
                                        onPrevious={() => setUpdatedPage(updatedPage - 1)}
                                        hasNext={updatedPage < Math.ceil(displayResults.updatedRows.length / updatedRowsPerPage)}
                                        onNext={() => setUpdatedPage(updatedPage + 1)}
                                        type="table"
                                        label={`${((updatedPage - 1) * updatedRowsPerPage) + 1}-${Math.min(updatedPage * updatedRowsPerPage, displayResults.updatedRows.length)} of ${displayResults.updatedRows.length}`}
                                    />
                                )}
                            </s-section>
                        </s-box>
                    )}

                    {displayResults.failedRows?.length > 0 && (
                        <s-box paddingBlockStart="large">
                            <s-section heading="❌ Failed Rows">
                                <s-table>
                                    <s-table-header-row>
                                        {Object.keys(displayResults.failedRows[0] || {}).map((key) => (
                                            <s-table-header key={key}>{key}</s-table-header>
                                        ))}
                                    </s-table-header-row>
                                    <s-table-body>
                                        {displayResults.failedRows
                                            .slice((failedPage - 1) * failedRowsPerPage, failedPage * failedRowsPerPage)
                                            .map((row, index) => (
                                                <s-table-row key={index}>
                                                    {Object.keys(displayResults.failedRows[0] || {}).map((key, cellIndex) => (
                                                        <s-table-cell key={cellIndex}>
                                                            {row[key]?.toString() || '-'}
                                                        </s-table-cell>
                                                    ))}
                                                </s-table-row>
                                            ))}
                                    </s-table-body>
                                </s-table>
                                {displayResults.failedRows.length > failedRowsPerPage && (
                                    <Pagination
                                        hasPrevious={failedPage > 1}
                                        onPrevious={() => setFailedPage(failedPage - 1)}
                                        hasNext={failedPage < Math.ceil(displayResults.failedRows.length / failedRowsPerPage)}
                                        onNext={() => setFailedPage(failedPage + 1)}
                                        type="table"
                                        label={`${((failedPage - 1) * failedRowsPerPage) + 1}-${Math.min(failedPage * failedRowsPerPage, displayResults.failedRows.length)} of ${displayResults.failedRows.length}`}
                                    />
                                )}
                            </s-section>
                        </s-box>
                    )}

                    {displayResults.skippedRows?.length > 0 && (
                        <s-box paddingBlockStart="large" paddingBlockEnd="large">
                            <s-section heading="⏭️ Skipped Rows - Prices Already Match">
                                <s-table>
                                    <s-table-header-row>
                                        {Object.keys(displayResults.skippedRows[0] || {}).map((key) => (
                                            <s-table-header key={key}>{key}</s-table-header>
                                        ))}
                                    </s-table-header-row>
                                    <s-table-body>
                                        {displayResults.skippedRows
                                            .slice((skippedPage - 1) * skippedRowsPerPage, skippedPage * skippedRowsPerPage)
                                            .map((row, index) => (
                                                <s-table-row key={index}>
                                                    {Object.keys(displayResults.skippedRows[0] || {}).map((key, cellIndex) => (
                                                        <s-table-cell key={cellIndex}>
                                                            {row[key]?.toString() || '-'}
                                                        </s-table-cell>
                                                    ))}
                                                </s-table-row>
                                            ))}
                                    </s-table-body>
                                </s-table>
                                {displayResults.skippedRows.length > skippedRowsPerPage && (
                                    <Pagination
                                        hasPrevious={skippedPage > 1}
                                        onPrevious={() => setSkippedPage(skippedPage - 1)}
                                        hasNext={skippedPage < Math.ceil(displayResults.skippedRows.length / skippedRowsPerPage)}
                                        onNext={() => setSkippedPage(skippedPage + 1)}
                                        type="table"
                                        label={`${((skippedPage - 1) * skippedRowsPerPage) + 1}-${Math.min(skippedPage * skippedRowsPerPage, displayResults.skippedRows.length)} of ${displayResults.skippedRows.length}`}
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
