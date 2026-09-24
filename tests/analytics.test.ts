import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyzeSnapshot } from '../lib/analytics/analyze.ts';
import type { RawBusinessSnapshot, SnapshotKpis, SnapshotProduct } from '../lib/analytics/types.ts';

const kpis = (over: Partial<SnapshotKpis> = {}): SnapshotKpis => ({
  revenue: 0, net_revenue: 0, orders: 0, avg_ticket: 0, guests: 0, items_sold: 0, tips: 0, tax: 0, discounts: 0,
  comps: 0, ingredient_cost: 0, waste_cost: 0, shrinkage_cost: 0, voided_payments: 0, cancelled_items: 0, cancelled_value: 0,
  ...over,
});

const product = (name: string, quantity: number, netUnit: number, costUnit: number): SnapshotProduct => ({
  product_id: name, name, category: 'X', station: 'bar', quantity, comped_quantity: 0,
  revenue: quantity * netUnit * 1.08, net_revenue: quantity * netUnit, cost: quantity * costUnit, comped_cost: 0,
});

function snapshot(over: Partial<RawBusinessSnapshot> = {}): RawBusinessSnapshot {
  return {
    period: {
      from: '2026-09-01T05:00:00Z', to: '2026-09-08T05:00:00Z', previous_from: '2026-08-25T05:00:00Z',
      previous_to: '2026-09-01T05:00:00Z', days: 7, timezone: 'America/Bogota', currency: 'COP',
      kds_warning_minutes: 10, kds_late_minutes: 20,
    },
    kpis: kpis({ revenue: 1_000_000, net_revenue: 925_926, orders: 40, avg_ticket: 25_000, guests: 80, ingredient_cost: 280_000 }),
    previous_kpis: kpis({ revenue: 1_000_000, net_revenue: 925_926, orders: 40, avg_ticket: 25_000, ingredient_cost: 270_000 }),
    daily: [], weekdays: [{ dow: 5, days: 1, orders: 10, revenue: 400_000 }],
    heatmap: [{ dow: 5, hour: 21, orders: 6, revenue: 250_000 }, { dow: 2, hour: 18, orders: 1, revenue: 20_000 }],
    products: [], unsold_products: [], categories: [], staff: [], stations: [], table_minutes: 55,
    payments: { card: 600_000, cash: 400_000 }, channels: {},
    cash: { sessions: 1, total_difference: 0, differences: [] },
    inventory: { stock_value: 0, low_stock: [], usage: [] },
    ...over,
  };
}

test('ingeniería de menú: estrella, caballo de batalla, enigma y perro', () => {
  const a = analyzeSnapshot(
    snapshot({
      products: [
        product('Mojito', 100, 20_000, 5_000), // popular y rentable
        product('Cerveza', 120, 8_000, 3_000), // popular, margen bajo
        product('Gin premium', 10, 40_000, 9_000), // poco vendido, margen alto
        product('Nachos', 8, 9_000, 5_000), // poco vendido, margen bajo
      ],
    }),
  );
  const cls = Object.fromEntries(a.menu.products.map((p) => [p.name, p.class]));
  assert.deepEqual(cls, { Mojito: 'star', Cerveza: 'plowhorse', 'Gin premium': 'puzzle', Nachos: 'dog' });
  assert.equal(a.menu.products.find((p) => p.name === 'Mojito')!.food_cost_pct, 25);
});

test('variaciones y razones contra el periodo anterior', () => {
  const a = analyzeSnapshot(snapshot({ previous_kpis: kpis({ revenue: 1_250_000, net_revenue: 1_157_407, ingredient_cost: 300_000 }) }));
  assert.equal(a.changes.revenue.change_pct, -20);
  assert.equal(a.ratios.food_cost_pct, 30.2);
  assert.equal(a.ratios.revenue_per_guest, 12_500);
  assert.equal(a.peak_hours[0]!.label, 'Viernes 21:00');
  assert.equal(a.weekdays[0]!.avg_revenue, 400_000);
  const drop = a.anomalies.find((x) => x.kind === 'revenue_drop');
  assert.equal(drop?.severity, 'warning');
});

test('anomalías: faltantes de inventario, caja, descuentos por mesero y demoras', () => {
  const a = analyzeSnapshot(
    snapshot({
      kpis: kpis({ revenue: 1_000_000, net_revenue: 925_926, orders: 40, avg_ticket: 25_000, ingredient_cost: 450_000 }),
      inventory: {
        stock_value: 0,
        low_stock: [{ name: 'Ron', unit: 'ml', stock: 100, min: 750 }],
        usage: [
          { ingredient_id: 'ron', name: 'Ron', unit: 'ml', sold: 6000, waste: 0, shrinkage: 1500, purchased: 0, cost: 0 },
          { ingredient_id: 'soda', name: 'Soda', unit: 'ml', sold: 9000, waste: 100, shrinkage: 0, purchased: 0, cost: 0 },
        ],
      },
      cash: { sessions: 2, total_difference: -40_000, differences: [{ closed_at: '2026-09-05T06:00:00Z', difference: -40_000, closed_by: 'Caja 1' }] },
      staff: [
        { profile_id: 'a', name: 'Ana', role: 'waiter', orders: 20, revenue: 500_000, avg_ticket: 25_000, discounts: 60_000, discounted_orders: 6, comps: 20_000, voided_payments: 3 },
        { profile_id: 'b', name: 'Beto', role: 'waiter', orders: 20, revenue: 500_000, avg_ticket: 25_000, discounts: 0, discounted_orders: 0, comps: 0, voided_payments: 0 },
      ],
      stations: [{ station: 'kitchen', items: 50, avg_minutes: 16, p90_minutes: 31, pct_warning: 60, pct_late: 34 }],
    }),
  );
  const kinds = a.anomalies.map((x) => x.id);
  assert.ok(kinds.includes('food_cost_high'));
  assert.ok(kinds.includes('shrinkage:ron'));
  assert.ok(!kinds.includes('shrinkage:soda'));
  assert.ok(kinds.includes('cash_difference:0'));
  assert.ok(kinds.includes('staff_discounts:a') && !kinds.includes('staff_discounts:b'));
  assert.ok(kinds.includes('staff_voids:a'));
  assert.ok(kinds.includes('station_delays:kitchen'));
  assert.ok(kinds.includes('low_stock'));
  // Las críticas van primero.
  assert.equal(a.anomalies[0]!.severity, 'critical');
});

test('sin ventas no hay divisiones por cero ni anomalías falsas', () => {
  const a = analyzeSnapshot(snapshot({ kpis: kpis(), previous_kpis: kpis(), heatmap: [], weekdays: [] }));
  assert.equal(a.ratios.food_cost_pct, null);
  assert.equal(a.changes.revenue.change_pct, null);
  assert.deepEqual(a.anomalies, []);
  assert.deepEqual(a.menu.products, []);
});
