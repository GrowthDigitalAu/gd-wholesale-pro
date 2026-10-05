/* eslint-env node */
import test from 'node:test';
import assert from 'node:assert/strict';
import { withPricingHistory, reconcileImportHistory, mutationError } from './pricing-history.server.js';

function fixture(outcome) {
  const records = [], updates = [], calls = [];
  const db = { pricingAudit: { create: async ({ data }) => { const entry = { id: String(records.length), ...data }; records.push(entry); return entry; }, updateMany: async update => { updates.push(update); } } };
  const admin = { graphql: async query => {
    calls.push(query);
    if (query.includes('PricingAuditSnapshot')) return Response.json({ data: { productVariant: { id: 'v', metafield: { value: '10' } } } });
    if (outcome instanceof Error) throw outcome;
    return Response.json(outcome);
  } };
  return { db, records, updates, calls, admin: withPricingHistory(admin, { shop: 'one.myshopify.com', userId: 17 }, db) };
}
const args = { variables: { metafields: [{ ownerId: 'v', namespace: '$app', key: 'gd_b2b_price', value: '12' }] } };
test('successful manual mutations record before, after and actor, then applied status', async () => {
  const f = fixture({ data: { metafieldsSet: { userErrors: [], metafields: [{ value: '12' }] } } });
  await f.admin.graphql('mutation UpdatePrice {}', args);
  assert.equal(f.records[0].beforeValue, '10');
  assert.equal(f.records[0].afterValue, '12');
  assert.equal(f.records[0].actor, 'Shopify user 17');
  assert.equal(f.updates[0].data.status, 'APPLIED');
  assert.equal(f.updates[0].where.shop, 'one.myshopify.com');
});
test('Shopify user errors never record successful pricing updates', async () => {
  const f = fixture({ data: { metafieldsSet: { userErrors: [{ message: 'Invalid price' }] } } });
  await assert.rejects(f.admin.graphql('mutation UpdatePrice {}', args), /Invalid price/);
  assert.equal(f.updates[0].data.status, 'FAILED');
});
test('network uncertainty is distinct from confirmed failure', async () => {
  const f = fixture(new Error('network'));
  await assert.rejects(f.admin.graphql('mutation UpdatePrice {}', args));
  assert.equal(f.updates[0].data.status, 'UNKNOWN');
});
test('untracked queries pass through without audit entries', async () => {
  const f = fixture({ data: { shop: {} } });
  await f.admin.graphql('query { shop { id } }');
  assert.equal(f.records.length, 0);
  assert.equal(mutationError({ errors: [{ message: 'Access denied' }] }), 'Access denied');
});
test('import reconciliation only applies confirmed variants and is store-scoped', async () => {
  const updates = [];
  await reconcileImportHistory({ pricingAudit: { updateMany: async value => updates.push(value) } }, 'one', 'operation', [
    { data: { productVariantsBulkUpdate: { productVariants: [{ id: 'v1' }], userErrors: [] } } },
    { productVariantsBulkUpdate: { productVariants: [{ id: 'v2' }], userErrors: [{ message: 'invalid' }] } },
  ], 'COMPLETED');
  assert.deepEqual(updates[0].where.variantId.in, ['v1']);
  assert.equal(updates[0].where.shop, 'one');
  assert.equal(updates[1].data.status, 'UNKNOWN');
});
