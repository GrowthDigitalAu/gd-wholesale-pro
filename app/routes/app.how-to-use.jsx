export default function HowToUse() {
    return (
        <s-page heading="Setup Guide" inlineSize="large">
            <div className="page-frame">
                <s-section heading="Why use GD Wholesale Pro">
                    <div className="import-guide-grid">
                        <div>
                            <h3>More than 3 catalogs</h3>
                            <p className="panel-copy">Start with practical groups like Wholesale, Distributor, and VIP, then add more tiers as your trade program grows.</p>
                        </div>
                        <div>
                            <h3>Exact SKU pricing by group</h3>
                            <p className="panel-copy">Set one manual price for Gold buyers and another price for Distributor buyers on the same variant.</p>
                        </div>
                        <div>
                            <h3>Application-to-price workflow</h3>
                            <p className="panel-copy">Collect buyer details, approve the account, assign the group, and let the app apply the correct storefront and checkout pricing.</p>
                        </div>
                    </div>
                </s-section>

                <s-box paddingBlockStart="large" />

                <s-section heading="Wholesale quick-order page">
                    <p className="panel-copy">Create a Wholesale Order page in Online Store, then open its page template in the Theme Editor. Add the Wholesale Quick Order app block, select a collection, and save. Assign that template to your page and add the page to your store navigation. Modern themes do not require manual code edits; older themes may need app-block support.</p>
                    <p className="panel-copy">Buyers must sign in with an approved wholesale account. Search loads the other pages of the selected collection, and entered quantities stay selected while paging or filtering. Large collections may take time to load and remain subject to Shopify Liquid pagination and variant limits. Minimum quantities are shown beside prices.</p>
                    <p className="panel-copy">Buyers can save up to 20 named order lists with up to 100 variants each. Lists belong to the signed-in customer and work across devices. Loading a list replaces the current selection after confirmation, skips unavailable variants, and raises quantities to current minimums for review. Recent paid orders can also be loaded for reordering; normal order access covers the last 60 days, and orders over 100 lines are not supported.</p>
                    <p className="panel-copy">Prices are estimates until cart and checkout apply the active discount rules. Fixed wholesale price estimates are shown in the store&apos;s base currency; other currencies show retail estimates pending checkout conversion. Keep the GD: Wholesale Pro app embed enabled for the existing storefront pricing and cart controls, and verify that the wholesale discount function is active before launch.</p>
                </s-section>
                <s-box paddingBlockStart="large" />
                <s-section heading="Pricing change history">
                    <s-link href="/app/saved-order-lists">Customer saved-list data export</s-link>
                    <p className="panel-copy">Open Pricing History to review manual variant-price, group-price and minimum-quantity edits, plus price imports recorded after this release. Each entry includes an actor, timestamp, previous value, requested value and outcome. Applied means Shopify confirmed success; pending or unknown records require verification. Import outcomes refresh when you open history, including when the import screen was closed. External Shopify edits and automated plan-limit cleanup are not recorded. Restoring old prices is not included in this release.</p>
                </s-section>
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
                                    <p>Open Wholesale Groups, choose Pricing beside an active group, then enter variant prices or select Import. Download the Excel template with SKU and Wholesale Price columns. Export downloads the same format for that group.</p>
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
                                <p className="panel-copy">Use this when each product or SKU has its own wholesale price. In Wholesale Pricing, select a group such as Gold or Distributor, then enter that group&apos;s price for each variant.</p>
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
                                    <p>Go to Wholesale Groups, enter a group name, choose one supported tag, and set the pricing method to Manual variant prices.</p>
                                </div>
                            </div>
                            <div className="help-step">
                                <span>2</span>
                                <div>
                                    <strong>Enter group variant prices</strong>
                                    <p>Go to Wholesale Pricing, choose the group in the Price list selector, enter each variant&apos;s price, and save.</p>
                                </div>
                            </div>
                            <div className="help-step">
                                <span>3</span>
                                <div>
                                    <strong>Approve buyers and test</strong>
                                    <p>On Wholesale Applications, select the group before approving. The customer receives B2B_approved plus the group tag, then checkout uses that group&apos;s variant price.</p>
                                </div>
                            </div>
                        </div>
                    </s-section>
                </s-box>

                <s-box paddingBlockStart="large">
                    <s-section heading="Group imports and exports">
                        <p className="panel-copy">Go to Wholesale Groups, choose Pricing, then Import, Export, or Download Template. Each group file uses SKU and Wholesale Price. Blank prices are ignored; null or 0 clears only that group&apos;s price. Use Import All Groups or Export All Groups in Wholesale Pricing for a combined file.</p>
                        <div className="import-guide-grid">
                            <div>
                                <h3>Required</h3>
                                <p className="panel-copy"><strong>SKU</strong> identifies the variant. A group import also requires <strong>Wholesale Price</strong>. Use an Excel .xlsx workbook with headers in the first row.</p>
                            </div>
                            <div>
                                <h3>Optional price fields</h3>
                                <p className="panel-copy"><strong>Price</strong> updates the retail variant price. <strong>Compare-at Price</strong> updates the sale anchor price.</p>
                            </div>
                            <div>
                                <h3>Optional wholesale fields</h3>
                                <p className="panel-copy"><strong>Min Qty</strong> sets the minimum wholesale quantity. <strong>B2B Price</strong> sets the fallback fixed wholesale price.</p>
                            </div>
                            <div>
                                <h3>Optional group price fields</h3>
                                <p className="panel-copy">Use one column per group, such as <strong>B2B_gold Price</strong>, <strong>B2B_distributor Price</strong>, or <strong>VIP Price</strong>.</p>
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
                                    <p>For a group, map SKU and Wholesale Price. All-group imports additionally support retail, compare-at, minimum quantity, default B2B, and group price columns.</p>
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
