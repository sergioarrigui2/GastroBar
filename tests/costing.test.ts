import assert from 'node:assert/strict';
import { test } from 'node:test';
import { costProduct, foodCostLevel, netOfTax, subRecipeUnitCost } from '../lib/catalog/costing.ts';

const ingredients = new Map([
  ['ron', { id: 'ron', cost_per_unit: 60 }],
  ['azucar', { id: 'azucar', cost_per_unit: 4 }],
  ['limon', { id: 'limon', cost_per_unit: 12 }],
]);
const jarabe = { id: 'jarabe', yield_quantity: 1000, lines: [{ ingredient_id: 'azucar', quantity: 650 }] };
const subRecipes = new Map([['jarabe', jarabe]]);

test('costo unitario de sub-receta = costo del lote / rendimiento', () => {
  assert.equal(subRecipeUnitCost(jarabe, ingredients), 2.6);
});

test('costo por porción con insumos directos y sub-recetas', () => {
  const result = costProduct(
    28_000,
    [
      { ingredient_id: 'ron', quantity: 60 },
      { ingredient_id: 'limon', quantity: 25 },
      { sub_recipe_id: 'jarabe', quantity: 20 },
    ],
    ingredients,
    subRecipes,
  );
  assert.equal(result.cost, 60 * 60 + 25 * 12 + 20 * 2.6);
  assert.ok(Math.abs(result.foodCostPct! - (3952 / 28_000) * 100) < 1e-9);
  assert.equal(foodCostLevel(result.foodCostPct), 'good');
});

test('precio 0 no produce márgenes', () => {
  assert.deepEqual(costProduct(0, [], ingredients, subRecipes), { cost: 0, marginPct: null, foodCostPct: null });
  assert.equal(foodCostLevel(40), 'high');
});

test('netOfTax: el food cost se mide sobre el precio sin impuesto incluido', () => {
  assert.equal(netOfTax(10_800, 8, true), 10_000);
  assert.equal(netOfTax(10_000, 19, false), 10_000);
  assert.equal(netOfTax(10_000, 0, true), 10_000);
});
