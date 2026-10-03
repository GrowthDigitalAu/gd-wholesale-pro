/* eslint-env node */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../../extensions/b2b-price/assets/b2b-quick-order.js', import.meta.url), 'utf8');
function setup(values, response = { ok: true, json: async () => ({ items: [] }) }) {
  let component;
  const requests = [];
  vm.runInNewContext(source, {
    HTMLElement: class {},
    customElements: { get: () => false, define: (_, value) => { component = value; } },
    window: { Shopify: { routes: { root: '/en-au/' } } },
    fetch: async (url, options) => { requests.push({ url, body: JSON.parse(options.body) }); return response; },
  });
  const widget = new component();
  widget.status = { textContent: '' };
  widget.button = { disabled: false };
  const total = { textContent: '' };
  widget.querySelector = () => total;
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
