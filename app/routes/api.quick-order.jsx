import { authenticate } from '../shopify.server';
import db from '../db.server';
import { validateOrderList } from '../utils/saved-order-lists';

const json = (data, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store, private' } });
async function buyerContext(request) {
  const { admin, session } = await authenticate.public.appProxy(request);
  const customerId = new URL(request.url).searchParams.get('logged_in_customer_id');
  if (!session || !admin || !/^[1-9]\d{0,19}$/.test(customerId || '')) throw json({ error: 'Sign in to use saved lists.' }, 401);
  const response = await admin.graphql(`#graphql
    query QuickOrderBuyer($id: ID!) {
      customer(id: $id) { tags }
      shop { metafield(namespace: "gd_price_updator", key: "subscription_active") { value } }
    }`, { variables: { id: `gid://shopify/Customer/${customerId}` } });
  const data = await response.json();
  if (data.errors || !data.data?.customer) throw json({ error: 'Unable to verify wholesale access.' }, 403);
  if (!data.data.customer.tags.some(tag => tag.toLowerCase() === 'b2b_approved') || data.data.shop.metafield?.value !== 'true') {
    throw json({ error: 'An approved wholesale account and active app access are required.' }, 403);
  }
  return { shop: session.shop, customerId };
}
export const loader = async ({ request }) => {
  const where = await buyerContext(request);
  const lists = await db.savedOrderList.findMany({ where, orderBy: { updatedAt: 'desc' }, select: { id: true, name: true, items: true, updatedAt: true } });
  if (new URL(request.url).searchParams.get('orders') === 'true') {
    const { admin } = await authenticate.public.appProxy(request);
    const response = await admin.graphql(`#graphql
      query QuickOrderHistory($id: ID!) {
        customer(id: $id) {
          orders(first: 10, reverse: true, query: "financial_status:paid") {
            nodes { id name lineItems(first: 100) { pageInfo { hasNextPage } nodes { quantity variant { id } } } }
          }
        }
      }`, { variables: { id: `gid://shopify/Customer/${where.customerId}` } });
    const data = await response.json();
    if (data.errors) return json({ error: 'Order history is unavailable. Check the app order permissions.' }, 403);
    const orders = (data.data?.customer?.orders?.nodes || []).map(order => {
      const quantities = new Map();
      for (const line of order.lineItems.nodes) {
        if (line.variant) {
          const id = line.variant.id.split('/').pop();
          quantities.set(id, (quantities.get(id) || 0) + line.quantity);
        }
      }
      return { id: order.id, name: order.name, items: [...quantities].map(([id, quantity]) => ({ id, quantity })), truncated: order.lineItems.pageInfo.hasNextPage };
    });
    return json({ orders });
  }
  return json({ lists });
};
export const action = async ({ request }) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  const owner = await buyerContext(request);
  // Custom header and JSON-only bodies prevent cross-site form submissions.
  if (request.headers.get('x-gd-quick-order') !== '1' || !request.headers.get('content-type')?.startsWith('application/json')) return json({ error: 'Invalid request.' }, 400);
  if (Number(request.headers.get('content-length')) > 20000) return json({ error: 'List is too large.' }, 413);
  const raw = await request.text();
  if (raw.length > 20000) return json({ error: 'List is too large.' }, 413);
  let body;
  try { body = JSON.parse(raw); } catch { return json({ error: 'Invalid JSON.' }, 400); }
  if (body.intent === 'delete') {
    if (typeof body.id !== 'string') return json({ error: 'Choose a list.' }, 400);
    await db.savedOrderList.deleteMany({ where: { ...owner, id: body.id } });
    return json({ success: true });
  }
  if (body.intent !== 'save') return json({ error: 'Invalid action.' }, 400);
  let list;
  try { list = validateOrderList(body); } catch (error) { return json({ error: error.message }, 400); }
  const saved = await db.$transaction(async tx => {
    // Serialize list quota checks for this customer, including concurrent requests.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${owner.shop + ':' + owner.customerId}))`;
    const existing = await tx.savedOrderList.findUnique({ where: { shop_customerId_name: { ...owner, name: list.name } } });
    if (!existing && await tx.savedOrderList.count({ where: owner }) >= 20) return null;
    return tx.savedOrderList.upsert({ where: { shop_customerId_name: { ...owner, name: list.name } }, create: { ...owner, ...list }, update: list, select: { id: true, name: true } });
  });
  return saved ? json({ success: true, list: saved }) : json({ error: 'You can save up to 20 lists. Delete a list before adding another.' }, 400);
};
