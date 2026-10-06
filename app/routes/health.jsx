import db from '../db.server';
import { getPricingAppHandle } from '../utils/app-pricing.server';

export const loader = async () => {
  try {
    await db.savedOrderList.findFirst({ select: { id: true } });
    await db.pricingAudit.findFirst({ select: { id: true } });
    return Response.json({ status: 'ready', release: 'wholesale-20261006-plan-selection-screen', pricingHandle: getPricingAppHandle() }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ status: 'not-ready' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
};
