// @ts-check
import { DiscountApplicationStrategy } from "../generated/api";

/**
 * @typedef {import("../generated/api").RunInput} RunInput
 * @typedef {import("../generated/api").FunctionRunResult} FunctionRunResult
 */

/**
 * @type {FunctionRunResult}
 */
const EMPTY_DISCOUNT = {
  discountApplicationStrategy: DiscountApplicationStrategy.First,
  discounts: [],
}

const DEFAULT_MINIMUM_WHOLESALE_ORDER_VALUE = 500;

function parseGroupRules(input) {
  const rawValue = input.shop?.groupRules?.value;
  if (!rawValue) return [];

  try {
    const parsed = JSON.parse(rawValue);
    return Array.isArray(parsed?.groups) ? parsed.groups : [];
  } catch (error) {
    console.log("Invalid B2B group rules metafield", error);
    return [];
  }
}

function findMatchedGroupRule(input) {
  const customer = input.cart.buyerIdentity?.customer;
  const matchedTags = (customer?.groupTags || [])
    .filter((tagResult) => tagResult.hasTag)
    .map((tagResult) => tagResult.tag);

  if (matchedTags.length === 0) return null;

  const rules = parseGroupRules(input);
  return rules.find((rule) => matchedTags.includes(rule.customerTag)) || null;
}

function getGroupVariantPrice(line, matchedGroupRule) {
  if (!matchedGroupRule?.customerTag) return null;

  const rawValue = line.merchandise?.groupPriceMetafield?.value;
  if (!rawValue) return null;

  try {
    const groupPrices = JSON.parse(rawValue);
    const targetPrice = Number(groupPrices?.[matchedGroupRule.customerTag]);
    return targetPrice > 0 ? targetPrice : null;
  } catch (error) {
    console.log("Invalid B2B group variant price metafield", error);
    return null;
  }
}

/**
 * @param {RunInput} input
 * @returns {FunctionRunResult}
 */
export function run(input) {
  const discounts = [];

  const customer = input.cart.buyerIdentity?.customer;
  if (!customer || !customer.hasAnyTag) {
    return EMPTY_DISCOUNT;
  }

  const matchedGroupRule = findMatchedGroupRule(input);
  const groupMinimumOrder = Number(matchedGroupRule?.minimumOrder || 0);
  const percentageOff = matchedGroupRule?.pricingMethod === "PERCENTAGE_OFF"
    ? Number(matchedGroupRule.discountValue || 0)
    : 0;
  let prospectiveDiscountAmount = 0;

  for (const line of input.cart.lines) {
    if (line.merchandise && line.merchandise.__typename === "ProductVariant") {
      const metaValue = line.merchandise.metafield?.value;
      const minQtyValue = line.merchandise.minQtyMetafield?.value;

      const currentPrice = parseFloat(line.cost.amountPerQuantity.amount);
      const requiredMinQty = minQtyValue ? parseInt(minQtyValue, 10) : 1;

      // Check Minimum Quantity rule first
      if (line.quantity < requiredMinQty) {
        console.log(`No discount: Line quantity (${line.quantity}) is less than required minimum (${requiredMinQty})`);
        continue; // Skip calculating discount for this line
      }

      if (percentageOff > 0 && percentageOff < 100) {
        const totalLineDiscountAmount = currentPrice * (percentageOff / 100) * line.quantity;
        prospectiveDiscountAmount += totalLineDiscountAmount;

        discounts.push({
          targets: [{ cartLine: { id: line.id } }],
          value: {
            percentage: {
              value: percentageOff.toString()
            }
          },
          message: `${matchedGroupRule.name || "B2B"} Wholesale Price`
        });
      } else {
        const groupVariantPrice = getGroupVariantPrice(line, matchedGroupRule);
        const targetPrice = groupVariantPrice || (metaValue ? parseFloat(metaValue) : null);

        // Calculate difference
        if (targetPrice && targetPrice < currentPrice) {
          const discountAmountPerItem = currentPrice - targetPrice;
          const totalLineDiscountAmount = discountAmountPerItem * line.quantity;
          const percentage = (discountAmountPerItem / currentPrice) * 100;

          if (percentage > 0) {
            prospectiveDiscountAmount += totalLineDiscountAmount;
            
            discounts.push({
              targets: [{ cartLine: { id: line.id } }],
              value: {
                percentage: {
                  value: percentage.toString()
                }
              },
              message: groupVariantPrice && matchedGroupRule?.name
                ? `${matchedGroupRule.name} Wholesale Price`
                : "B2B Wholesale Price"
            });
          }
        } else if (targetPrice) {
          console.log(`No discount: Target >= Current`);
        } else if (percentageOff <= 0) {
          console.log("No Metafield Value found for variant");
        }
      }
    }
  }

  if (discounts.length === 0) {
    return EMPTY_DISCOUNT;
  }

  // Check if the user opted out of B2B discounts via the Cart Interceptor
  const isOptedOut = input.cart.attribute && input.cart.attribute.value === "true";

  // Calculate the projected cart total with B2B discounts applied
  const cartSubtotal = parseFloat(input.cart.cost?.subtotalAmount?.amount || "0");
  const postDiscountCartTotal = cartSubtotal - prospectiveDiscountAmount;

  // If the projected wholesale total is under $500, we check the opt-out status
  // If the wholesale total is >= $500, we completely ignore the opt-out check and auto-restore discounts
  const minimumOrderValue = groupMinimumOrder > 0 ? groupMinimumOrder : DEFAULT_MINIMUM_WHOLESALE_ORDER_VALUE;

  if (postDiscountCartTotal < minimumOrderValue) {
    if (isOptedOut) {
      console.log(`B2B Opt-Out Active: Cart wholesale total is under threshold ($${postDiscountCartTotal.toFixed(2)})`);
      return EMPTY_DISCOUNT;
    }
  }

  return {
    discountApplicationStrategy: DiscountApplicationStrategy.All,
    discounts: discounts,
  };
}
