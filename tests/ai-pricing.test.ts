import assert from 'node:assert/strict';
import { test } from 'node:test';
import { costUsd, priceFor } from '../lib/ai/pricing.ts';

test('costo real medido: informe con Sonnet 5 (4.695 entrada, 2.704 salida)', () => {
  // 4695 × $2/MTok + 2704 × $10/MTok = 0.00939 + 0.02704
  assert.equal(costUsd('claude-sonnet-5', { input: 4695, output: 2704 }), 0.03643);
});

test('la caché se cobra aparte y no se cuenta dos veces', () => {
  // 1.000 normales × 2 + 8.000 leídos × 0.2 + 1.000 escritos × 2.5 + 500 salida × 10
  assert.equal(costUsd('claude-sonnet-5', { input: 10_000, output: 500, cacheRead: 8000, cacheWrite: 1000 }), 0.0111);
});

test('ids con fecha usan el precio del modelo base; modelos desconocidos no inventan costo', () => {
  assert.deepEqual(priceFor('claude-haiku-4-5-20251001'), priceFor('claude-haiku-4-5'));
  assert.equal(costUsd('modelo-desconocido', { input: 1000, output: 1000 }), null);
});
