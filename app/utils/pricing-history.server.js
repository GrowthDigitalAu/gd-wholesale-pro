export const AUDIT_KEYS = ['gd_b2b_price', 'gd_b2b_group_prices', 'gd_b2b_min_qty'];
export const auditActor = session => session.userId ? `Shopify user ${session.userId}` : 'Shop admin session';

export function mutationError(data) {
  const errors = [...(data.errors || [])];
  Object.values(data.data || {}).forEach(value => errors.push(...(value?.userErrors || [])));
  if (errors.length) return errors.map(error => error.message).join('; ');
  if (!data.data) return 'Shopify did not return a mutation result.';
  return null;
}

// Save an intent before calling Shopify, then confirm the outcome, never an assumed success.
export function withPricingHistory(admin, session, db) {
  const graphql = admin.graphql.bind(admin);
  return { ...admin, graphql: async (query, options) => {
    const fields = options?.variables?.metafields;
    if (!/\bmutation\b/.test(query) || !Array.isArray(fields)) return graphql(query, options);
    const tracked = fields.filter(field => field.namespace === '$app' && AUDIT_KEYS.includes(field.key));
    if (!tracked.length) return graphql(query, options);
    const entries = [];
    for (const field of tracked) {
      const response = await graphql(`#graphql
        query PricingAuditSnapshot($id: ID!, $namespace: String!, $key: String!) {
          productVariant(id: $id) { id metafield(namespace: $namespace, key: $key) { value } }
        }`, { variables: { id: field.ownerId, namespace: field.namespace, key: field.key } });
      const snapshot = await response.json();
      if (snapshot.errors || !snapshot.data?.productVariant) throw new Error('Unable to capture pricing history; update not sent.');
      const beforeValue = snapshot.data.productVariant.metafield?.value ?? null;
      const afterValue = field.value ?? null;
      if (beforeValue === afterValue) continue;
      entries.push(await db.pricingAudit.create({ data: {
        shop: session.shop, actor: auditActor(session), source: 'MANUAL', variantId: field.ownerId,
        field: field.key, beforeValue, afterValue,
      } }));
    }
    const where = { shop: session.shop, id: { in: entries.map(entry => entry.id) } };
    let response;
    try { response = await graphql(query, options); }
    catch (error) {
      await db.pricingAudit.updateMany({ where, data: { status: 'UNKNOWN', error: 'Request interrupted; verify current Shopify values.' } });
      throw error;
    }
    const data = await response.clone().json();
    const error = mutationError(data);
    await db.pricingAudit.updateMany({ where, data: { status: error ? 'FAILED' : 'APPLIED', error } });
    if (error) throw new Error(error);
    return response;
  } };
}

export async function reconcileImportHistory(db, shop, operationId, results, terminalStatus) {
  if (terminalStatus !== 'COMPLETED') {
    await db.pricingAudit.updateMany({ where: { shop, operationId, status: 'PENDING' }, data: { status: 'UNKNOWN', error: `Import ended with ${terminalStatus}; verify current Shopify values.` } });
    return;
  }
  for (const result of results) {
    const payload = result.data?.productVariantsBulkUpdate || result.productVariantsBulkUpdate;
    if (!payload) continue;
    const ids = (payload.productVariants || []).map(variant => variant.id);
    if (payload.userErrors?.length) continue;
    await db.pricingAudit.updateMany({ where: { shop, operationId, status: 'PENDING', variantId: { in: ids } }, data: { status: 'APPLIED' } });
  }
  await db.pricingAudit.updateMany({ where: { shop, operationId, status: 'PENDING' }, data: { status: 'UNKNOWN', error: 'No confirmed variant success in bulk result; verify Shopify values.' } });
}

export async function refreshPendingImports(db, admin, shop) {
  const pending = await db.pricingAudit.findMany({ where: { shop, source: 'IMPORT', status: 'PENDING', operationId: { startsWith: 'gid://shopify/BulkOperation/' } }, distinct: ['operationId'], select: { operationId: true }, take: 3 });
  for (const entry of pending) {
    const response = await admin.graphql(`#graphql
      query AuditImportStatus($id: ID!) { node(id: $id) { ... on BulkOperation { status url } } }
    `, { variables: { id: entry.operationId } });
    const data = await response.json();
    const operation = data.data?.node;
    if (!operation || ['CREATED', 'RUNNING', 'CANCELING'].includes(operation.status)) continue;
    if (operation.status === 'COMPLETED' && operation.url) {
      const file = await fetch(operation.url);
      if (!file.ok) continue;
      const results = (await file.text()).split('\n').filter(line => line.trim()).map(line => JSON.parse(line));
      await reconcileImportHistory(db, shop, entry.operationId, results, operation.status);
    } else {
      await reconcileImportHistory(db, shop, entry.operationId, [], operation.status);
    }
  }
}
