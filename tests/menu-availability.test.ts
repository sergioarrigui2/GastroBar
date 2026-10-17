import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { withStockPolicy } from '../lib/menu-availability.ts';

const menu = [
  { name: 'Agotado por stock', is_available: false, available_portions: 0 },
  { name: 'Con stock', is_available: true, available_portions: 4 },
];

describe('política de stock negativo en el menú', () => {
  test('sin permitir negativos, el menú queda como lo calcula el inventario', () => {
    assert.deepEqual(withStockPolicy(menu, false).map((p) => p.is_available), [false, true]);
  });

  test('permitiendo negativos todo se puede pedir y se conservan las porciones', () => {
    const out = withStockPolicy(menu, true);
    assert.deepEqual(out.map((p) => p.is_available), [true, true]);
    assert.deepEqual(out.map((p) => p.available_portions), [0, 4]);
  });
});
