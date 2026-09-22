import { useState, useEffect, useRef } from "react";
import { useFetcher } from "react-router";
import { authenticate } from "../shopify.server";
import ExcelJS from "exceljs";
import { useAppBridge } from "@shopify/app-bridge-react";
import { Pagination, ProgressBar } from "@shopify/polaris";
import { getVariantLimitForPlan } from "../utils/subscription";

const IMPORT_FIELDS = [
    {
        key: "SKU",
        label: "SKU",
        required: true,
        aliases: ["sku", "variant sku", "variant_sku", "product sku", "barcode"],
        help: "Required. Used to match each row to a Shopify variant."
    },
    {
        key: "Price",
        label: "Retail price",
        required: false,
        aliases: ["price", "retail price", "shopify price", "current price", "variant price"],
        help: "Optional. Updates Shopify variant price."
    },
    {
        key: "CompareAt Price",
        label: "Compare-at price",
        required: false,
        aliases: ["compare at price", "compare-at price", "compare_at_price", "rrp", "was price"],
        help: "Optional. Use null to clear an existing compare-at price."
    },
    {
        key: "Min Qty",
        label: "Minimum quantity",
        required: false,
        aliases: ["min qty", "minimum qty", "minimum quantity", "moq", "b2b min qty"],
        help: "Optional. Sets the minimum quantity required for wholesale pricing."
    },
    {
        key: "B2B Price",
        label: "B2B price",
        required: false,
        aliases: ["b2b price", "wholesale price", "trade price", "dealer price", "b2b_price"],
        help: "Optional. Sets the fixed wholesale price for approved buyers. Use null or 0 to clear it."
    }
];

const normalizeHeader = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");

const guessColumn = (headers, field) => {
    const candidates = [field.key, ...field.aliases].map(normalizeHeader);
    return headers.find((header) => candidates.includes(normalizeHeader(header))) || "";
};

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
                } catch (error) {
                    console.error("Failed to read bulk operation results:", error);
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
    const { admin, session } = await authenticate.admin(request);
    const formData = await request.formData();
    const dataString = formData.get("data");
    const headersString = formData.get("headers");
    const mappingString = formData.get("mapping");
    const rawRows = JSON.parse(dataString);
    const headersFromFrontend = headersString ? JSON.parse(headersString) : null;
    const columnMapping = mappingString ? JSON.parse(mappingString) : {};
    const rows = rawRows.map((row) => {
        const normalizedRow = {};
        IMPORT_FIELDS.forEach((field) => {
            const sourceColumn = columnMapping[field.key] || field.key;
            normalizedRow[field.key] = sourceColumn ? row[sourceColumn] : undefined;
        });
        return normalizedRow;
    });

    const results = {
        total: rows.length,
        updated: 0,
        updatedPrice: 0,
        updatedCompareAt: 0,
        updatedMinQty: 0,
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
        allColumns = [...headersFromFrontend, "SKU", "Price", "CompareAt Price", "Min Qty", "B2B Price"]
            .filter((value, index, array) => value && array.indexOf(value) === index);
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
    const variantLimit = getVariantLimitForPlan(planName, session.shop);

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
                        minQtyMetafield: metafield(namespace: "$app", key: "gd_b2b_min_qty") {
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
                    b2bMetafieldId: node.metafield?.id || null,
                    minQty: node.minQtyMetafield?.value !== undefined && node.minQtyMetafield?.value !== null ? parseInt(node.minQtyMetafield.value, 10) : null,
                    minQtyMetafieldId: node.minQtyMetafield?.id || null
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

    const hasB2BPriceColumn = rows.length > 0 && Object.prototype.hasOwnProperty.call(rows[0], "B2B Price");
    
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
            const minQtyRaw = row["Min Qty"];

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

            if (b2bPriceRaw !== undefined && b2bPriceRaw !== null) {
                const trimmed = String(b2bPriceRaw).trim();
                
                if (trimmed.toLowerCase() === "null") {
                    newB2BPrice = 0;
                } else if (trimmed !== "") {
                    const parsed = parseFloat(trimmed);
                    if (!isNaN(parsed)) {
                        newB2BPrice = parsed;
                    }
                }
            }

            let newMinQty = null;

            if (minQtyRaw !== undefined && minQtyRaw !== null) {
                const trimmed = String(minQtyRaw).trim();
                
                if (trimmed.toLowerCase() === "null") {
                    newMinQty = 0;
                } else if (trimmed !== "") {
                    const parsed = parseInt(trimmed, 10);
                    if (!isNaN(parsed)) {
                        newMinQty = parsed;
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

            let minQtyUpdated = false;
            variantInput.metafields = [];

            if (newB2BPrice !== null && variantData.b2bPrice !== newB2BPrice) {
                variantInput.metafields.push(variantData.b2bMetafieldId ? {
                    id: variantData.b2bMetafieldId,
                    value: String(newB2BPrice),
                    type: "number_decimal"
                } : {
                    namespace: "$app",
                    key: "gd_b2b_price",
                    value: String(newB2BPrice),
                    type: "number_decimal"
                });
                needsUpdate = true;
                b2bUpdated = true;
            }

            if (newMinQty !== null && variantData.minQty !== newMinQty) {
                variantInput.metafields.push(variantData.minQtyMetafieldId ? {
                    id: variantData.minQtyMetafieldId,
                    value: String(newMinQty),
                    type: "number_integer"
                } : {
                    namespace: "$app",
                    key: "gd_b2b_min_qty",
                    value: String(newMinQty),
                    type: "number_integer"
                });
                needsUpdate = true;
                minQtyUpdated = true;
            }

            if (variantInput.metafields.length === 0) {
                delete variantInput.metafields;
            }

            if (!needsUpdate) {
                results.skippedRows.push(normalizeRow(row, { "Reason": 'Prices already match' }));
                continue;
            }

            let b2bLimitReached = false;

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
                        // Limit reached - remove B2B price from update but continue with other prices
                        b2bLimitReached = true;
                        variantInput.metafields = variantInput.metafields.filter(m => m.key !== "gd_b2b_price" && m.id !== variantData.b2bMetafieldId);
                        if (variantInput.metafields.length === 0) delete variantInput.metafields;
                        b2bUpdated = false; // Mark as not updated
                        results.limitReachedCount++;
                    } else {
                        currentB2BCount++;
                    }
                } else if (!isAddingMeaningfulB2BPrice && !isRemovingMeaningfulB2BPrice) {
                    // Just updating existing B2B price value, no limit check needed
                }
            }

            // Check if we still have any updates after potentially removing B2B
            const hasRemainingUpdates = priceUpdated || compareAtUpdated || b2bUpdated || minQtyUpdated;
            
            if (!hasRemainingUpdates && b2bLimitReached) {
                // Only B2B was being updated and it was blocked by limit
                results.errors.push(`SKU ${sku}: B2B Price limit reached. Your ${planName || 'Free'} plan allows ${variantLimit} variants with B2B prices.`);
                results.failedRows.push(normalizeRow(row, { "Error Reason": 'B2B Price limit reached' }));
                continue;
            }

            if (priceUpdated) results.updatedPrice++;
            if (compareAtUpdated) results.updatedCompareAt++;
            if (minQtyUpdated) results.updatedMinQty++;
            if (b2bUpdated) results.updatedB2B++;

            // Track which columns were updated
            const updatedColumns = [];
            if (priceUpdated) updatedColumns.push('Price updated');
            if (compareAtUpdated) updatedColumns.push('CompareAt Price updated');
            if (minQtyUpdated) updatedColumns.push('Min Qty updated');
            if (b2bUpdated) updatedColumns.push('B2B Price updated');
            
            // Add to updated rows with simple reason
            results.updatedRows.push(normalizeRow(row, { 
                "Reason": updatedColumns.join(', ')
            }));

            // If B2B was blocked, also add to failed rows with detailed message
            if (b2bLimitReached) {
                const successfulUpdates = [];
                if (priceUpdated) successfulUpdates.push('Price updated');
                if (compareAtUpdated) successfulUpdates.push('CompareAt Price updated');
                
                const failReason = successfulUpdates.length > 0 
                    ? `${successfulUpdates.join(', ')}, but B2B Price limit reached`
                    : 'B2B Price limit reached';
                
                results.errors.push(`SKU ${sku}: ${failReason}. Your ${planName || 'Free'} plan allows ${variantLimit} variants with B2B prices.`);
                results.failedRows.push(normalizeRow(row, { "Error Reason": failReason }));
            }

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
    const [headersInOrder, setHeadersInOrder] = useState([]);
    const [columnMapping, setColumnMapping] = useState({});
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
            setParsedData(null);
            setHeadersInOrder([]);
            setColumnMapping({});

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
                        if (Object.values(rowData).some(value => value !== undefined && value !== null && String(value).trim() !== "")) {
                            jsonData.push(rowData);
                        }
                    }
                });
                setParsedData(jsonData);
                const headersInOrder = headers.filter(h => h); // Remove empty entries
                setHeadersInOrder(headersInOrder);
                setColumnMapping(Object.fromEntries(IMPORT_FIELDS.map(field => [field.key, guessColumn(headersInOrder, field)])));
                shopify.toast.show(`File loaded: ${jsonData.length} rows. Review the column mapping before importing.`, { duration: 5000 });
            };
            reader.readAsArrayBuffer(selectedFile);
        }
    };

    const handleButtonClick = () => {
        if (fileInputRef.current) fileInputRef.current.click();
    };

    const handleMappingChange = (fieldKey, sourceColumn) => {
        setColumnMapping(prev => ({
            ...prev,
            [fieldKey]: sourceColumn
        }));
    };

    const handleStartImport = () => {
        if (!parsedData || parsedData.length === 0) {
            shopify.toast.show("Upload a file with at least one data row.", { isError: true });
            return;
        }

        if (!columnMapping["SKU"]) {
            shopify.toast.show("Map the SKU column before importing.", { isError: true });
            return;
        }

        setIsProgressVisible(true);
        setProgress(10);
        fetcher.submit({
            data: JSON.stringify(parsedData),
            headers: JSON.stringify(headersInOrder),
            mapping: JSON.stringify(columnMapping)
        }, { method: "POST" });
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
                shopify.toast.show('Import complete', { duration: 5000 });
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
                           updatedMinQty: validatedResults.updatedMinQty || 0,
                           updatedB2B: validatedResults.updatedB2B || 0,
                           errors: [...validatedResults.errors, ...bulkRes.errors]
                       };
                       setFinalResults(merged);
                       setProgress(100);
                       
                       shopify.toast.show('Import complete', { duration: 5000 });
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
        <s-page heading="Import Prices" inlineSize="large">
            <div className="page-frame">
            <div className="workflow-strip">
                <div className={`workflow-step ${file ? "is-complete" : "is-active"}`}><span>1</span><strong>Choose file</strong></div>
                <div className={`workflow-step ${validatedResults ? "is-complete" : parsedData ? "is-active" : ""}`}><span>2</span><strong>Map columns</strong></div>
                <div className={`workflow-step ${finalResults ? "is-complete" : validatedResults?.bulkOperationId ? "is-active" : ""}`}><span>3</span><strong>Update Shopify</strong></div>
                <div className={`workflow-step ${finalResults ? "is-active" : ""}`}><span>4</span><strong>Review results</strong></div>
            </div>

            <s-box>
                <s-section heading="Upload a price file">
                    <div className="import-guide-grid">
                        <div>
                            <h3>Required column</h3>
                            <p className="panel-copy"><strong>SKU</strong> is required. It is used to match each row to a Shopify variant.</p>
                        </div>
                        <div>
                            <h3>Optional columns</h3>
                            <p className="panel-copy">Price, Compare-at Price, Min Qty, and B2B Price can be mapped from any column names in your file.</p>
                        </div>
                        <div>
                            <h3>Blank cells</h3>
                            <p className="panel-copy">Blank optional cells are ignored. Use <strong>null</strong> to clear compare-at, minimum quantity, or B2B price where supported.</p>
                        </div>
                    </div>
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
                        Choose Excel File
                    </s-button>
                </s-section>
            </s-box>

            {parsedData && !isProgressVisible && !displayResults && (
                <s-box paddingBlockStart="large">
                    <s-section heading="Map columns">
                        <div className="mapping-grid">
                            {IMPORT_FIELDS.map((field) => (
                                <label key={field.key}>
                                    {field.label} {field.required ? "(required)" : "(optional)"}
                                    <select
                                        value={columnMapping[field.key] || ""}
                                        onChange={(event) => handleMappingChange(field.key, event.target.value)}
                                    >
                                        <option value="">Do not import</option>
                                        {headersInOrder.map((header) => (
                                            <option key={header} value={header}>{header}</option>
                                        ))}
                                    </select>
                                    <span>{field.help}</span>
                                </label>
                            ))}
                        </div>
                        <div className="file-meta">
                            <span>{file?.name}</span>
                            <span>{parsedData.length} rows found</span>
                            <span>{headersInOrder.length} columns found</span>
                        </div>
                        <div className="button-row">
                            <button className="primary-action-button" type="button" onClick={handleStartImport} disabled={isLoading}>
                                Start Import
                            </button>
                            <s-button onClick={handleButtonClick}>Choose Different File</s-button>
                        </div>
                    </s-section>
                </s-box>
            )}

            {isProgressVisible && (
                <div className="progress-container">
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
                                <s-text as="p">Successfully updated Min Qty: {displayResults.updatedMinQty || 0}</s-text>
                                <s-text as="p">Successfully updated B2B Price: {displayResults.updatedB2B || 0}</s-text>
                                <s-text as="p">Errors: {displayResults.errors.length}</s-text>
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
            </div>
        </s-page>
    );
}
