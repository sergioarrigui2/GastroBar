import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  checkCustomSplit,
  remainingBalance,
  splitByItems,
  splitEqually,
  suggestedTip,
} from '../lib/billing/split-bill.ts';

test('splitEqually conserva el total exacto (2 decimales)', () => {
  const parts = splitEqually(100, 3);
  assert.deepEqual(parts, [33.34, 33.33, 33.33]);
  assert.equal(Math.round(parts.reduce((a, b) => a + b, 0) * 100), 10000);
});

test('splitEqually en moneda sin decimales (COP)', () => {
  assert.deepEqual(splitEqually(100_000, 3, 0), [33_334, 33_333, 33_333]);
});

test('splitByItems reparte líneas compartidas y respeta lo ya pagado', () => {
  const lines = [
    { id: 'a', name: 'Mojito', lineTotal: 50_000, allocated: 0 },
    { id: 'b', name: 'Nachos', lineTotal: 30_001, allocated: 0 },
    { id: 'c', name: 'Cerveza', lineTotal: 12_000, allocated: 12_000 }, // ya pagada
    { id: 'd', name: 'Agua', lineTotal: 5_000, allocated: 0 }, // sin asignar
  ];
  const { shares, unassigned } = splitByItems(lines, { a: [0], b: [0, 1], c: [1] }, ['Ana', 'Beto'], 0);
  assert.equal(shares[0]?.amount, 50_000 + 15_001);
  assert.equal(shares[1]?.amount, 15_000);
  assert.equal(unassigned, 5_000);
  assert.deepEqual(shares[1]?.allocations, [{ order_item_id: 'b', amount: 15_000 }]);
});

test('checkCustomSplit detecta excedentes y faltantes', () => {
  assert.deepEqual(checkCustomSplit([40, 50], 100), { assigned: 90, difference: 10, valid: true });
  assert.equal(checkCustomSplit([60, 50], 100).valid, false);
  assert.equal(checkCustomSplit([0, 100], 100).valid, false);
});

test('remainingBalance y suggestedTip', () => {
  assert.equal(remainingBalance(100.1, 50.05), 50.05);
  assert.equal(remainingBalance(10, 20), 0);
  assert.equal(suggestedTip(91_000, 10, 0), 9_100);
});
