const VIP_STORES = {
    // Format: 'store-domain.myshopify.com': { limit: number, expiry: 'YYYY-MM-DD' }
    'app-development-test-2.myshopify.com': { limit: 500, expiry: '2027-04-10' }, 
    'kissmyhide2026.myshopify.com': { limit: 500, expiry: '2027-04-01' }, 
};

export function getVariantLimitForPlan(planName, shop) {
    const vip = VIP_STORES[shop];
    if (vip) {
        const today = new Date();
        const expiryDate = new Date(vip.expiry);
        
        if (today <= expiryDate) {
            return vip.limit;
        }
        // If expired, it will continue to check the Shopify plan below
    }

    if (!planName) return 10;
    
    const lowerPlan = planName.toLowerCase();
    
    if (lowerPlan.includes('startup')) return 100;
    if (lowerPlan.includes('growth')) return 500;
    if (lowerPlan.includes('expand')) return null;
    
    return 10;
}

export function getGroupLimitForPlan(planName) {
    if (!planName) return 1;

    const lowerPlan = planName.toLowerCase();

    if (lowerPlan.includes('startup')) return 3;
    if (lowerPlan.includes('growth')) return 10;
    if (lowerPlan.includes('expand')) return null;

    return 1;
}

export const SUBSCRIPTION_TIERS = {
    FREE: { name: 'Free', limit: 10, groupLimit: 1 },
    STARTUP: { name: 'Startup', limit: 100, groupLimit: 3 },
    GROWTH: { name: 'Growth', limit: 500, groupLimit: 10 },
    EXPAND: { name: 'Expand', limit: null, groupLimit: null }
};

