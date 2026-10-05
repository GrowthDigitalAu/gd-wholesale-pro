import { useLoaderData, Form } from 'react-router';
import { authenticate } from '../shopify.server';
import db from '../db.server';
import { refreshPendingImports } from '../utils/pricing-history.server';

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  let refreshError = null;
  try { await refreshPendingImports(db, admin, session.shop); } catch { refreshError = 'Some import outcomes could not be refreshed. Pending records are not confirmed successes.'; }
  const params = new URL(request.url).searchParams;
  const page = Math.max(1, Math.min(10000, Number.parseInt(params.get('page'), 10) || 1));
  const q = (params.get('q') || '').trim().slice(0, 100);
  const status = ['PENDING', 'APPLIED', 'FAILED', 'UNKNOWN'].includes(params.get('status')) ? params.get('status') : '';
  const where = { shop: session.shop, ...(status ? { status } : {}), ...(q ? { OR: [{ variantId: { contains: q } }, { actor: { contains: q } }, { afterValue: { contains: q } }] } : {}) };
  const entries = await db.pricingAudit.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * 50, take: 51 });
  return { entries: entries.slice(0, 50), hasNext: entries.length > 50, page, q, status, refreshError };
};
export default function PricingHistory() {
  const { entries, hasNext, page, q, status, refreshError } = useLoaderData();
  const href = next => `/app/pricing-history?${new URLSearchParams({ page: String(next), q, status })}`;
  return <s-page heading="Pricing History" inlineSize="large"><div className="page-frame">
    {refreshError && <s-banner tone="warning">{refreshError}</s-banner>}
    <s-section><p>Changes recorded from this release onward. Pending or unknown outcomes are not confirmed updates. Group price values are stored by customer tag. Automated plan-limit cleanup and external Shopify edits are not included.</p>
      <Form method="get" className="button-row"><label>Variant / actor / value<input name="q" defaultValue={q} /></label><label>Status<select name="status" defaultValue={status}><option value="">All</option>{['APPLIED', 'PENDING', 'FAILED', 'UNKNOWN'].map(value => <option key={value}>{value}</option>)}</select></label><button type="submit">Filter</button></Form>
    </s-section>
    <s-section><div style={{ overflowX: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse' }}><thead><tr>{['Time (UTC)', 'Actor', 'Source', 'Variant', 'Field', 'Before', 'Requested After', 'Outcome'].map(label => <th key={label} style={{ padding: 10, textAlign: 'left' }}>{label}</th>)}</tr></thead><tbody>{entries.map(entry => <tr key={entry.id}>{[new Date(entry.createdAt).toISOString(), entry.actor, entry.source, entry.variantId, entry.field, entry.beforeValue ?? '(unset)', entry.afterValue ?? '(cleared)', `${entry.status}${entry.error ? ': ' + entry.error : ''}`].map((value, index) => <td key={index} style={{ padding: 10, borderTop: '1px solid #ddd', maxWidth: 220, overflowWrap: 'anywhere', verticalAlign: 'top' }}>{value}</td>)}</tr>)}</tbody></table></div>{!entries.length && <p>No recorded changes match this filter.</p>}<div className="button-row">{page > 1 && <s-link href={href(page - 1)}>Previous</s-link>}<span>Page {page}</span>{hasNext && <s-link href={href(page + 1)}>Next</s-link>}</div></s-section>
  </div></s-page>;
}
