/* eslint-env node */
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateOrderList } from './saved-order-lists.js';
test('saved lists retain only current variant identifiers and quantities', () => {
  assert.deepEqual(validateOrderList({ name: ' Weekly ', items: [{ id: '123', quantity: 4, price: 9, customerId: 'other' }] }), { name: 'Weekly', items: [{ id: '123', quantity: 4 }] });
});
test('invalid, duplicate and excessive list items are rejected', () => {
  for (const body of [
    { name: '', items: [{ id: '1', quantity: 1 }] },
    { name: 'A', items: [] },
    { name: 'A', items: [{ id: '1', quantity: 1.5 }] },
    { name: 'A', items: [{ id: '../2', quantity: 1 }] },
    { name: 'A', items: [{ id: '1', quantity: -1 }] },
    { name: 'A', items: [{ id: '1', quantity: 1 }, { id: '1', quantity: 2 }] },
    { name: 'A', items: Array.from({ length: 101 }, (_, i) => ({ id: String(i + 1), quantity: 1 })) },
  ]) assert.throws(() => validateOrderList(body));
});
