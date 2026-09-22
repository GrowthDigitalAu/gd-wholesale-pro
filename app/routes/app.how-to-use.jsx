export default function HowToUse() {
    return (
        <s-page heading="Setup Guide" inlineSize="large">
            <div className="page-frame">
                <div className="help-layout">
                    <s-section heading="Recommended setup path">
                        <div className="help-steps">
                            <div className="help-step">
                                <span>1</span>
                                <div>
                                    <strong>Add the storefront blocks</strong>
                                    <p>Enable the B2B price display and application form blocks in the theme editor.</p>
                                </div>
                            </div>
                            <div className="help-step">
                                <span>2</span>
                                <div>
                                    <strong>Create the wholesale application</strong>
                                    <p>Collect the buyer details you need, then copy the form ID into the theme block.</p>
                                </div>
                            </div>
                            <div className="help-step">
                                <span>3</span>
                                <div>
                                    <strong>Set wholesale pricing</strong>
                                    <p>Add B2B prices and minimum quantities manually, or import them with a spreadsheet.</p>
                                </div>
                            </div>
                            <div className="help-step">
                                <span>4</span>
                                <div>
                                    <strong>Test as an approved buyer</strong>
                                    <p>Use a customer tagged with B2B_approved and confirm product, cart, and checkout pricing.</p>
                                </div>
                            </div>
                        </div>
                    </s-section>
                    <s-section heading="Need-to-know">
                        <div className="action-panel">
                            <p className="panel-copy">Approved buyers need the B2B_approved customer tag for the current checkout discount to apply.</p>
                            <p className="panel-copy">Use Wholesale Groups to prepare Gold, Distributor, VIP, or regional tiers for the next rule-based pricing pass.</p>
                            <s-link href="/gd-wholesale-pro-how-to-use.pdf" download target="_blank">Download PDF</s-link>
                        </div>
                    </s-section>
                </div>

                <s-box paddingBlockStart="large">
                    <s-section heading="Import file columns">
                        <div className="import-guide-grid">
                            <div>
                                <h3>Required</h3>
                                <p className="panel-copy"><strong>SKU</strong> must be present or mapped. It identifies the Shopify variant to update.</p>
                            </div>
                            <div>
                                <h3>Optional price fields</h3>
                                <p className="panel-copy"><strong>Price</strong> updates the retail variant price. <strong>Compare-at Price</strong> updates the sale anchor price.</p>
                            </div>
                            <div>
                                <h3>Optional wholesale fields</h3>
                                <p className="panel-copy"><strong>Min Qty</strong> sets the minimum wholesale quantity. <strong>B2B Price</strong> sets the fixed wholesale price.</p>
                            </div>
                        </div>
                        <div className="help-steps">
                            <div className="help-step">
                                <span>1</span>
                                <div>
                                    <strong>Upload Excel</strong>
                                    <p>The first row should contain your column names. Column names do not need to match exactly.</p>
                                </div>
                            </div>
                            <div className="help-step">
                                <span>2</span>
                                <div>
                                    <strong>Map columns</strong>
                                    <p>Map your file columns to SKU, Price, Compare-at Price, Min Qty, and B2B Price before importing.</p>
                                </div>
                            </div>
                            <div className="help-step">
                                <span>3</span>
                                <div>
                                    <strong>Review results</strong>
                                    <p>Blank optional cells are ignored. Use null where you want to clear supported values.</p>
                                </div>
                            </div>
                        </div>
                    </s-section>
                </s-box>
            </div>
        </s-page>
    );
}
