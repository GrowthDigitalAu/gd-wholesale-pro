import { useEffect, useState } from "react";
import { useFetcher } from "react-router";
import { authenticate } from "../shopify.server";
import ExcelJS from "exceljs";
import { useAppBridge } from "@shopify/app-bridge-react";
import { ProgressBar } from "@shopify/polaris";


export const action = async ({ request }) => {
    const { admin } = await authenticate.admin(request);

    const response = await admin.graphql(
        `#graphql
    query getProducts {
      products(first: 50) {
        edges {
          node {
            variants(first: 10) {
              edges {
                node {
                  sku
                  price
                  compareAtPrice
                }
              }
            }
          }
        }
      }
    }`
    );

    const responseJson = await response.json();

    if (responseJson.errors) {
        return { success: false, error: "GraphQL errors occurred" };
    }

    const products = responseJson.data?.products?.edges || [];

    const rows = [];
    products.forEach((productEdge) => {
        const product = productEdge.node;

        product.variants.edges.forEach((variantEdge) => {
            const variant = variantEdge.node;
            rows.push({
                "SKU": variant.sku || "",
                "Price": variant.price || "",
                "CompareAt Price": variant.compareAtPrice || ""
            });
        });
    });

    if (rows.length === 0) {
        rows.push({
            "SKU": "",
            "Price": "",
            "CompareAt Price": ""
        });
    }

    return { success: true, rows };
};

export default function ExportProductData() {
    const shopify = useAppBridge();
    const fetcher = useFetcher();
    const [progress, setProgress] = useState(0);
    const [isProgressVisible, setIsProgressVisible] = useState(false);

    const isLoading = fetcher.state === "submitting" || fetcher.state === "loading";

    useEffect(() => {
        if (isLoading) {
            setIsProgressVisible(true);
            setProgress(0);

            const estimatedTimeMs = 3000;
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
    }, [isLoading, isProgressVisible]);

    useEffect(() => {
        if (!isLoading && fetcher.data?.success && isProgressVisible) {
            const timeout = setTimeout(() => {
                setIsProgressVisible(false);
            }, 300);
            return () => clearTimeout(timeout);
        }
    }, [isLoading, fetcher.data?.success, isProgressVisible]);

    const handleExport = () => {
        shopify.toast.show("Exporting products...");
        fetcher.submit(
            {},
            { method: "POST" }
        );
    };

    useEffect(() => {
        if (fetcher.data?.success && fetcher.state === "idle") {
            const workbook = new ExcelJS.Workbook();
            const worksheet = workbook.addWorksheet("Products");

            worksheet.addRow(Object.keys(fetcher.data.rows[0] || {}));

            fetcher.data.rows.forEach(row => worksheet.addRow(Object.values(row)));

            workbook.xlsx.writeBuffer().then(buffer => {
                const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = "products_export.xlsx";
                a.click();
                URL.revokeObjectURL(url);
                shopify.toast.show("Export complete");
            }).catch(err => {
                console.error(err);
                shopify.toast.show("Export failed");
            });
        } else if (fetcher.data?.error) {
            shopify.toast.show("Export failed");
        }
    }, [fetcher.data, fetcher.state, shopify]);

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
                    <s-text variant="bodyLg">Exporting product prices...</s-text>
                    <s-div className="ProcessMain">
                        <s-text className="ProcessInner"></s-text>
                    </s-div>
                </div>
            )}
        </s-page>
    );
}
