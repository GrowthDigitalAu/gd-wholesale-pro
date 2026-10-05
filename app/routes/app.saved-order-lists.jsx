import { Form, useLoaderData } from 'react-router';
import { authenticate } from '../shopify.server';
import db from '../db.server';

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const params = new URL(request.url).searchParams;
  const customerId = params.get('customerId') || '';
  const valid = /^[1-9]\d{0,19}$/.test(customerId);
  const lists = valid ? await db.savedOrderList.findMany({ where: { shop: session.shop, customerId }, orderBy: { updatedAt: 'desc' } }) : [];
  if (params.get('format') === 'json') {
    if (!valid) return Response.json({ error: 'Enter a valid Shopify customer ID.' }, { status: 400 });
    return Response.json({ customerId, lists }, { headers: { 'Cache-Control': 'no-store, private', 'Content-Disposition': 'attachment; filename="customer-saved-lists.json"' } });
  }
  return { customerId, lists, error: customerId && !valid ? 'Enter a numeric Shopify customer ID.' : null };
};
export default function SavedOrderLists() {
  const { customerId, lists, error } = useLoaderData();
  return <s-page heading="Customer Saved Lists"><s-section><Form method="get"><label>Shopify customer ID<input name="customerId" defaultValue={customerId} /></label><button type="submit">Find lists</button></Form>{error && <p>{error}</p>}{lists.length > 0 && <s-link href={`/app/saved-order-lists?customerId=${customerId}&format=json`}>Export customer list data</s-link>}{customerId && !error && !lists.length && <p>No saved lists for this customer.</p>}{lists.map(list => <div key={list.id}><h3>{list.name}</h3><p>Updated {new Date(list.updatedAt).toISOString()}</p><pre style={{ overflowX: 'auto' }}>{JSON.stringify(list.items, null, 2)}</pre></div>)}</s-section></s-page>;
}
