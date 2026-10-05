/* eslint-env node */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../../scripts/b2b-quick-order.js', import.meta.url), 'utf8');
function setup(values, response = { ok: true, json: async () => ({ items: [] }) }, overrides = {}) {
  let component;
  const requests = [];
  vm.runInNewContext(source, {
    HTMLElement: class {},
    customElements: { get: () => false, define: (_, value) => { component = value; } },
    window: { Shopify: { routes: { root: '/en-au/' } }, location: { href: 'https://shop.example/pages/wholesale' } },
    URL,
    fetch: async (url, options) => { requests.push({ url, body: options?.body ? JSON.parse(options.body) : null }); return response; },
    ...overrides,
  });
  const widget = new component();
  widget.status = { textContent: '' };
  widget.button = { disabled: false };
  const total = { textContent: '' };
  widget.querySelector = selector => selector === '[data-total]' ? total : null;
  widget.rows = values.map((value, index) => {
    const input = { value: String(value.quantity), disabled: !!value.disabled, focus() { this.focused = true; } };
    return { dataset: { variant: String(index + 1), minimum: String(value.minimum || 1) }, querySelector: () => input };
  });
  return { widget, requests, total };
}
test('submits multiple variants to locale-aware cart and resets successful quantities', async () => {
  const { widget, requests, total } = setup([{ quantity: 4, minimum: 3 }, { quantity: 2 }, { quantity: 5, disabled: true }]);
  await widget.addItems();
  assert.equal(requests[0].url, '/en-au/cart/add.js');
  assert.deepEqual(requests[0].body.items, [{ id: '1', quantity: 4 }, { id: '2', quantity: 2 }]);
  assert.equal(widget.rows[0].querySelector().value, '0');
  assert.equal(total.textContent, '0 units selected');
  assert.equal(widget.button.disabled, false);
});
test('rejects fractional, negative and below-minimum quantities before sending', async () => {
  for (const quantity of [1.5, -1, 2]) {
    const { widget, requests } = setup([{ quantity, minimum: 3 }]);
    await widget.addItems();
    assert.equal(requests.length, 0);
    assert.equal(widget.rows[0].querySelector().focused, true);
  }
});
test('empty selection and busy guard never submit', async () => {
  const { widget, requests } = setup([{ quantity: 0 }]);
  await widget.addItems();
  widget.busy = true;
  await widget.addItems();
  assert.equal(requests.length, 0);
});
test('cart rejection preserves quantities and releases controls', async () => {
  const { widget } = setup([{ quantity: 6 }], { ok: false, json: async () => ({ description: 'Not enough stock' }) });
  await widget.addItems();
  assert.match(widget.status.textContent, /Not enough stock/);
  assert.match(widget.status.textContent, /Check your cart/);
  assert.equal(widget.rows[0].querySelector().value, '6');
  assert.equal(widget.rows[0].querySelector().readOnly, false);
  assert.equal(widget.busy, false);
});

test('client pagination retains selections outside the visible page', () => {
  const { widget } = setup(Array.from({ length: 30 }, (_, i) => ({ quantity: i === 28 ? 7 : 0 })));
  widget.rows.forEach((row, i) => { row.textContent = `Product SKU-${i}`; });
  widget.query = '';
  widget.page = 0;
  widget.catalogComplete = true;
  const elements = new Map();
  widget.querySelector = selector => {
    if (!elements.has(selector)) elements.set(selector, { replaceChildren(...rows) { this.rows = rows; } });
    return elements.get(selector);
  };
  widget.showPage();
  assert.equal(elements.get('tbody').rows.length, 25);
  widget.page = 1;
  widget.showPage();
  assert.equal(elements.get('tbody').rows.length, 5);
  assert.equal(widget.selectedItems()[0].quantity, 7);
  widget.query = 'sku-28';
  widget.page = 0;
  widget.showPage();
  assert.equal(elements.get('tbody').rows.length, 1);
  assert.equal(widget.rows[28].querySelector().value, '7');
});

test('collection search loading deduplicates variants and preserves existing quantities', async () => {
  const input = { value: '0', disabled: false };
  const row = { dataset: { variant: '2' }, querySelector: () => input };
  const block = { dataset: { customer: 'c', group: 'Gold' }, querySelector: () => ({}), querySelectorAll: () => [row] };
  const { widget, requests } = setup([{ quantity: 8 }], { ok: true, text: async () => '<html></html>' }, { DOMParser: class { parseFromString() { return { getElementById: () => block }; } } });
  widget.id = 'block';
  widget.dataset = { customer: 'c', group: 'Gold' };
  widget.catalog = { dataset: { pages: '2', pageParam: 'page_list' } };
  widget.loadedPages = new Set([1]);
  await widget.loadCatalog();
  assert.equal(requests.length, 1);
  assert.match(requests[0].url, /page_list=2/);
  assert.equal(widget.rows.length, 2);
  assert.equal(widget.rows[0].querySelector().value, '8');
  assert.equal(widget.catalogComplete, true);
  await widget.loadCatalog();
  assert.equal(requests.length, 1);
});

test('catalog requests reject a changed customer session', async () => {
  const block = { dataset: { customer: 'other', group: 'Gold' }, querySelector: () => ({}) };
  const { widget } = setup([{ quantity: 3 }], { ok: true, text: async () => '' }, { DOMParser: class { parseFromString() { return { getElementById: () => block }; } } });
  widget.dataset = { customer: 'c', group: 'Gold' };
  widget.catalog = { dataset: { pages: '2', pageParam: 'page' } };
  widget.loadedPages = new Set([1]);
  await assert.rejects(widget.loadCatalog(), /session or price list changed/);
  assert.equal(widget.rows.length, 1);
});
