export function validateOrderList(body) {
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  if (!name || name.length > 80) throw new Error('Use a list name between 1 and 80 characters.');
  if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 100) throw new Error('Save between 1 and 100 variants.');
  const seen = new Set();
  const items = body.items.map(item => {
    const id = String(item?.id || '');
    if (!/^[1-9]\d{0,19}$/.test(id) || seen.has(id)) throw new Error('Variant IDs must be valid and unique.');
    if (!Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 100000) throw new Error('Use whole quantities between 1 and 100000.');
    seen.add(id);
    return { id, quantity: item.quantity };
  });
  return { name, items };
}
