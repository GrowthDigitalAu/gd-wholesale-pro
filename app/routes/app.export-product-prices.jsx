import { useEffect, useState } from "react";
import { useFetcher } from "react-router";
import { authenticate } from "../shopify.server";
import ExcelJS from "exceljs";
import { useAppBridge } from "@shopify/app-bridge-react";
import { ProgressBar } from "@shopify/polaris";

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

        // Return the status and URL (if complete) to the client
        // The client will handle the heavy lifting (download & parse)
        if (bulkOperation.status === "COMPLETED") {
             if (!bulkOperation.url) {
                 return { success: false, status: "FAILED", error: "No URL in completed bulk operation", operationId };
             }
             return { success: true, status: "COMPLETED", url: bulkOperation.url, operationId };
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

    // 1. Cancel existing operation if any (skip if this fails)
    try {
        const currentOpResponse = await admin.graphql(
            `#graphql
            query {
                currentBulkOperation {
                    id
                    status
                }
            }`
        );
        const currentOpData = await currentOpResponse.json();
        const currentOp = currentOpData.data?.currentBulkOperation;

        if (currentOp && currentOp.status !== "COMPLETED") {
             await admin.graphql(
                `#graphql
                mutation {
                    bulkOperationCancel(id: "${currentOp.id}") {
                        bulkOperation { status }
                        userErrors { field message }
                    }
                }`
            );
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    } catch (error) {
        console.error("Failed to check/cancel existing bulk operation:", error.message);
        console.log("Continuing with export anyway...");
        // Continue anyway - don't block the export
    }

    // 2. Run new operation
    const response = await admin.graphql(
        `#graphql
        mutation {
            bulkOperationRunQuery(
            query: """
                {
                    products {
                        edges {
                            node {
                                id
                                title
                                variants {
                                    edges {
                                        node {
                                            id
                                            sku
                                            selectedOptions {
                                                name
                                                value
                                            }
                                            price
                                            compareAtPrice
                                            metafield(namespace: "$app", key: "gd_b2b_price") {
                                                value
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            """
            ) {
                bulkOperation {
                    id
                    status
                }
                userErrors {
                    field
                    message
                }
            }
        }`
    );

    const result = await response.json();

    if (result.data?.bulkOperationRunQuery?.userErrors?.length > 0) {
        return { success: false, error: result.data.bulkOperationRunQuery.userErrors[0].message };
    }

    return { 
        success: true, 
        status: "CREATED", 
        operationId: result.data.bulkOperationRunQuery.bulkOperation.id 
    };
};

export default function ExportProductData() {
    const shopify = useAppBridge();
    const fetcher = useFetcher();
    const pollFetcher = useFetcher();

    const [progress, setProgress] = useState(0);
    const [isProgressVisible, setIsProgressVisible] = useState(false);
    const [currentExportOpId, setCurrentExportOpId] = useState(null);
    const [statusMessage, setStatusMessage] = useState("");

    const isLoading = fetcher.state === "submitting" || fetcher.state === "loading" || !!currentExportOpId;

    const handleExport = () => {
        setProgress(0);
        setStatusMessage("Starting export...");
        setIsProgressVisible(true);
        fetcher.submit({}, { method: "POST" });
    };

    // Detect Start
    useEffect(() => {
        if (fetcher.data?.success && fetcher.data?.status === "CREATED") {
            const opId = fetcher.data.operationId;
            setCurrentExportOpId(opId);
            setStatusMessage("Processing export...");
            shopify.toast.show("Export started...", { duration: 5000 });
            pollFetcher.load(`/app/export-product-prices?checkStatus=true&operationId=${opId}`);
        } else if (fetcher.data?.error) {
            shopify.toast.show(fetcher.data.error, { duration: 5000 });
            setIsProgressVisible(false);
        }
    }, [fetcher.data]);

    // Polling Logic
    useEffect(() => {
        if (currentExportOpId && pollFetcher.data) {
            const data = pollFetcher.data;
            if (data.operationId !== currentExportOpId) return;

            if (data.status === "RUNNING" || data.status === "CREATED") {
                const timer = setTimeout(() => {
                    pollFetcher.load(`/app/export-product-prices?checkStatus=true&operationId=${currentExportOpId}`);
                }, 2000);
                return () => clearTimeout(timer);

            } else if (data.status === "COMPLETED") {
                // Now processing on CLIENT SIDE
                setStatusMessage("Downloading & processing file...");
                setProgress(90);

                // Fetch the file directly from the URL provided by loader
                if (data.url) {
                    processExportFile(data.url);
                } else {
                    failExport("No file URL returned");
                }
                
            } else if (data.status === "FAILED" || data.status === "NONE") {
                failExport(data.error || "Unknown error");
            }
        }
    }, [pollFetcher.data, currentExportOpId]);

    const failExport = (reason) => {
        setCurrentExportOpId(null);
        setIsProgressVisible(false);
        shopify.toast.show("Export failed: " + reason, { duration: 5000 });
    };

    const processExportFile = async (url) => {
        try {
            // Client-side fetch
            const response = await fetch(url);
            if (!response.ok) throw new Error("Failed to download file");
            
            const text = await response.text();
            const lines = text.split("\n").filter(line => line.trim() !== "");

            const productsMap = new Map();
            const rows = [];

            setStatusMessage("Generating Excel...");

            // Parse JSONL
            lines.forEach(line => {
                try {
                    const obj = JSON.parse(line);
                    
                    if (obj.id && obj.id.includes("Product") && !obj.sku) {
                        productsMap.set(obj.id, { title: obj.title });
                    } else if (obj.id && obj.id.includes("ProductVariant")) {
                        const parentId = obj.__parentId;
                        const product = productsMap.get(parentId);
                        
                        const options = {
                            "Option1 Value": "",
                            "Option2 Value": "",
                            "Option3 Value": ""
                        };
                        
                        if (obj.selectedOptions) {
                            obj.selectedOptions.forEach((opt, index) => {
                                if (index < 3) {
                                    options[`Option${index + 1} Value`] = opt.value;
                                }
                            });
                        }
                        
                        let b2bPrice = obj.metafield?.value ? parseFloat(obj.metafield.value) : null;
                        if (b2bPrice === 0) b2bPrice = null; // Export as empty cell if 0

                        rows.push({
                            "Product Title": product?.title || "Unknown",
                            "SKU": obj.sku || "",
                            "Option1 Value": options["Option1 Value"],
                            "Option2 Value": options["Option2 Value"],
                            "Option3 Value": options["Option3 Value"],
                            "Price": obj.price ? parseFloat(obj.price) : null,
                            "CompareAt Price": obj.compareAtPrice ? parseFloat(obj.compareAtPrice) : null,
                            "B2B Price": b2bPrice
                        });
                    }
                } catch (e) {
                     console.error("Error parsing line", e);
                }
            });

            if (rows.length === 0) {
                 rows.push({
                    "Product Title": "No data found",
                    "SKU": "",
                    "Option1 Value": "",
                    "Option2 Value": "",
                    "Option3 Value": "",
                    "Price": "",
                    "CompareAt Price": "",
                    "B2B Price": ""
                 });
            }

            // Generate Excel
            const workbook = new ExcelJS.Workbook();
            const worksheet = workbook.addWorksheet("Products");

            if (rows.length > 0) {
                worksheet.addRow(Object.keys(rows[0]));
                rows.forEach(row => worksheet.addRow(Object.values(row)));
            }

            const buffer = await workbook.xlsx.writeBuffer();
            const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
            const blobUrl = URL.createObjectURL(blob);
            
            const a = document.createElement("a");
            a.href = blobUrl;
            a.download = "product_prices_export.xlsx";
            a.click();
            URL.revokeObjectURL(blobUrl);

            setCurrentExportOpId(null);
            setProgress(100);
            shopify.toast.show("Export complete", { duration: 5000 });
            setTimeout(() => setIsProgressVisible(false), 1000);

        } catch (error) {
            console.error(error);
            failExport("Error processing file in browser");
        }
    };

    // Fake Progress
    useEffect(() => {
        if (isProgressVisible && currentExportOpId) {
             const interval = setInterval(() => {
                setProgress((prev) => {
                    if (prev < 80) return prev + 1; 
                    return prev; 
                });
            }, 500);
            return () => clearInterval(interval);
        }
    }, [isProgressVisible, currentExportOpId]);


    return (
        <s-page heading="Export Product Inventory Data">
            <s-box paddingBlockStart="large" paddingBlockEnd="large">
                <s-section heading='Click below to export all product price data.'>
                    <s-button
                        variant="primary"
                        onClick={handleExport}
                        loading={isLoading ? "true" : undefined}
                        paddingBlock="large"
                    >
                        Export Product Prices
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
                        <ProgressBar progress={progress} size="small" />
                    </div>
                    <s-text variant="bodyLg">
                         {statusMessage || "Processing..."}
                    </s-text>
                </div>
            )}
        </s-page>
    );
}
