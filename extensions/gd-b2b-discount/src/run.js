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

  for (const line of input.cart.lines) {
    if (line.merchandise) {
      const metaValue = line.merchandise.metafield?.value;

      if (metaValue) {
        const targetPrice = parseFloat(metaValue);
        const currentPrice = parseFloat(line.cost.amountPerQuantity.amount);

        // Calculate difference
        if (targetPrice < currentPrice) {
          const discountAmount = currentPrice - targetPrice;
          const percentage = (discountAmount / currentPrice) * 100;

          if (percentage > 0) {
            discounts.push({
              targets: [{ cartLine: { id: line.id } }],
              value: {
                percentage: {
                  value: percentage.toString()
                }
              },
              message: "B2B Price"
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

  return {
    discountApplicationStrategy: DiscountApplicationStrategy.All,
    discounts: discounts,
  };
};