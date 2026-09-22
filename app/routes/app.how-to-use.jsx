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
                                    <strong>Create wholesale groups</strong>
                                    <p>Create groups such as Wholesale, Distributor, VIP, Gold, or Trade and choose whether they use manual prices or percentage discounts.</p>
                                </div>
                            </div>
                            <div className="help-step">
                                <span>4</span>
                                <div>
                                    <strong>Set wholesale pricing</strong>
                                    <p>Add B2B prices and minimum quantities manually, import them with a spreadsheet, or use percentage-off group pricing.</p>
                                </div>
                            </div>
                            <div className="help-step">
                                <span>5</span>
                                <div>
                                    <strong>Test as an approved buyer</strong>
                                    <p>Use a customer tagged with B2B_approved plus the selected group tag and confirm product, cart, and checkout pricing.</p>
                                </div>
                            </div>
                        </div>
                    </s-section>
                    <s-section heading="Need-to-know">
                        <div className="action-panel">
                            <p className="panel-copy">Approved buyers need the B2B_approved customer tag for the current checkout discount to apply.</p>
                            <p className="panel-copy">Wholesale Groups add a second tag such as B2B_distributor or B2B_gold so each buyer can receive the right group pricing.</p>
                            <s-link href="/gd-wholesale-pro-how-to-use.pdf" download target="_blank">Download PDF</s-link>
                        </div>
                    </s-section>
                </div>

                <s-box paddingBlockStart="large">
                    <s-section heading="Wholesale group setup">
                        <div className="import-guide-grid">
                            <div>
                                <h3>Supported automatic tags</h3>
                                <p className="panel-copy">Use B2B_wholesale, B2B_distributor, B2B_vip, B2B_gold, B2B_silver, B2B_dealer, B2B_partner, or B2B_trade for percentage-off checkout rules.</p>
                            </div>
                            <div>
                                <h3>Manual variant prices</h3>
                                <p className="panel-copy">Use this when each product or SKU has its own wholesale price. Set prices in Wholesale Pricing or Import Prices.</p>
                            </div>
                            <div>
                                <h3>Percentage off retail</h3>
                                <p className="panel-copy">Use this for simple tiers. Example: Distributor with B2B_distributor and 20 means 20% off retail at checkout.</p>
                            </div>
                        </div>
                        <div className="help-steps">
                            <div className="help-step">
                                <span>1</span>
                                <div>
                                    <strong>Create the group</strong>
                                    <p>Go to Wholesale Groups, enter a group name, choose one supported tag, and set the pricing method.</p>
                                </div>
                            </div>
                            <div className="help-step">
                                <span>2</span>
                                <div>
                                    <strong>Approve buyers into the group</strong>
                                    <p>On Wholesale Applications, select the group before approving. The customer receives B2B_approved plus the group tag.</p>
                                </div>
                            </div>
                            <div className="help-step">
                                <span>3</span>
                                <div>
                                    <strong>Sync and test</strong>
                                    <p>Active group rules sync automatically. Use Sync Rules if needed, then test checkout with a tagged customer account.</p>
                                </div>
                            </div>
                        </div>
                    </s-section>
                </s-box>

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
