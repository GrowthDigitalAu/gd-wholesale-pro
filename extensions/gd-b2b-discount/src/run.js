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
};

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

  const TARGET_MIN_ORDER_VALUE = 500;
  let prospectiveDiscountAmount = 0;

  for (const line of input.cart.lines) {
    if (line.merchandise && line.merchandise.__typename === "ProductVariant") {
      const metaValue = line.merchandise.metafield?.value;
      const minQtyValue = line.merchandise.minQtyMetafield?.value;

      if (metaValue) {
        const targetPrice = parseFloat(metaValue);
        const currentPrice = parseFloat(line.cost.amountPerQuantity.amount);
        const requiredMinQty = minQtyValue ? parseInt(minQtyValue, 10) : 1;

        // Check Minimum Quantity rule first
        if (line.quantity < requiredMinQty) {
          console.log(`No discount: Line quantity (${line.quantity}) is less than required minimum (${requiredMinQty})`);
          continue; // Skip calculating discount for this line
        }

        // Calculate difference
        if (targetPrice < currentPrice) {
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
              message: "B2B Wholesale Price"
            });
          }
        } else {
          console.log(`No discount: Target >= Current`);
        }
      } else {
        console.log("No Metafield Value found for variant");
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
  if (postDiscountCartTotal < TARGET_MIN_ORDER_VALUE) {
    if (isOptedOut) {
      console.log(`B2B Opt-Out Active: Cart wholesale total is under threshold ($${postDiscountCartTotal.toFixed(2)})`);
      return EMPTY_DISCOUNT;
    }
  }

  return {
    discountApplicationStrategy: DiscountApplicationStrategy.All,
    discounts: discounts,
  };
};