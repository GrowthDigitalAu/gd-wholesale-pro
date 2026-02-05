/**
 * Get the variant limit based on subscription plan name
 * @param {string|null} planName - The subscription plan name
 * @returns {number|null} - The variant limit (null means unlimited)
 */
export function getVariantLimitForPlan(planName) {
    if (!planName) return 5; // Free tier
    
    const lowerPlan = planName.toLowerCase();
    
    if (lowerPlan.includes('startup')) return 10;
    if (lowerPlan.includes('growth')) return 15;
    if (lowerPlan.includes('expand')) return null; // Unlimited
    
    return 5; // Default to free tier if plan name doesn't match
}

/**
 * Subscription tier configuration
 */
export const SUBSCRIPTION_TIERS = {
    FREE: { name: 'Free', limit: 5 },
    STARTUP: { name: 'Startup', limit: 10 },
    GROWTH: { name: 'Growth', limit: 15 },
    EXPAND: { name: 'Expand', limit: null }
};
