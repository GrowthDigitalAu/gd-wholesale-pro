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

  for (const line of input.cart.lines) {
    if (line.merchandise && line.merchandise.__typename === "ProductVariant") {
      const metaValue = line.merchandise.metafield?.value;
      console.error(`Link: ${line.id}, Meta: ${metaValue}, Cost: ${line.cost.amountPerQuantity.amount}`);

      if (metaValue) {
        const targetPrice = parseFloat(metaValue);
        const currentPrice = parseFloat(line.cost.amountPerQuantity.amount);

        console.error(`Target: ${targetPrice}, Current: ${currentPrice}`);

        // Calculate difference
        if (targetPrice < currentPrice) {
          const discountAmount = currentPrice - targetPrice;
          console.error(`Applying Discount: ${discountAmount}`);

          if (discountAmount > 0.01) {
            discounts.push({
              targets: [{ cartLine: { id: line.id } }],
              value: {
                fixedAmount: {
                  amount: discountAmount
                }
              },
              message: "Special Price"
            });
          }
        } else {
          console.error(`No discount: Target >= Current`);
        }
      } else {
        console.error("No Metafield Value found for variant");
      }
    }
  }

  if (discounts.length === 0) {
    return EMPTY_DISCOUNT;
  }

  return {
    discountApplicationStrategy: DiscountApplicationStrategy.All,
    discounts: discounts,
  };
};