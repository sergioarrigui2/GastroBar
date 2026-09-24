import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyzeSnapshot } from '../lib/analytics/analyze.ts';
import type { RawBusinessSnapshot } from '../lib/analytics/types.ts';
import { buildFacts } from '../lib/analyst/facts.ts';
import { analystReportSchema, type AnalystReport, verifyReport } from '../lib/analyst/report.ts';

const money = (n: number) => `$ ${new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 }).format(n)}`;
const kpis = {
  revenue: 1_080_000, net_revenue: 1_000_000, orders: 20, avg_ticket: 54_000, guests: 45, items_sold: 70, tips: 60_000, tax: 80_000,
  discounts: 20_000, comps: 9_000, ingredient_cost: 300_000, waste_cost: 10_000, shrinkage_cost: 0, voided_payments: 0,
  cancelled_items: 0, cancelled_value: 0,
};
const raw: RawBusinessSnapshot = {
  period: {
    from: '2026-09-01T05:00:00Z', to: '2026-09-08T05:00:00Z', previous_from: '2026-08-25T05:00:00Z', previous_to: '2026-09-01T05:00:00Z',
    days: 7, timezone: 'America/Bogota', currency: 'COP', kds_warning_minutes: 10, kds_late_minutes: 20,
  },
  kpis,
  previous_kpis: { ...kpis, revenue: 900_000, net_revenue: 833_333 },
  daily: [], weekdays: [{ dow: 5, days: 1, orders: 8, revenue: 500_000 }], heatmap: [],
  products: [
    { product_id: 'm', name: 'Mojito', category: 'Cócteles', station: 'bar', quantity: 30, comped_quantity: 0, revenue: 660_000, net_revenue: 611_111, cost: 156_000, comped_cost: 0 },
  ],
  unsold_products: [], categories: [], staff: [], stations: [], table_minutes: null, payments: {}, channels: {},
  cash: { sessions: 0, total_difference: 0, differences: [] },
  inventory: { stock_value: 0, low_stock: [], usage: [] },
};
const facts = buildFacts(analyzeSnapshot(raw, money), { money, date: (iso) => iso.slice(0, 10) });

const report = (evidence: string, refs: string[]): AnalystReport => ({
  headline: 'Semana sólida con ventas al alza',
  health: 'good',
  summary: 'Las ventas crecieron frente a la semana anterior y el food cost se mantiene en un rango sano para un gastrobar.',
  highlights: [],
  findings: [{ title: 'Ventas al alza', severity: 'opportunity', evidence, evidence_refs: refs, impact: 'aprox. más caja', action: 'Mantener' }],
  menu_actions: [],
  questions: [],
});

test('los hechos traen las cifras formateadas y con id citable', () => {
  const ventas = facts.find((f) => f.id === 'ventas');
  assert.match(ventas!.text, /\$ 1\.080\.000 \(anterior \$ 900\.000, \+20%\)/);
  assert.ok(facts.some((f) => f.id === 'p1' && f.text.includes('Mojito [Estrella]')));
  assert.ok(facts.some((f) => f.id === 'food_cost' && f.text.includes('30%')));
});

test('verificación: acepta cifras copiadas de los hechos', () => {
  const v = verifyReport(report('Vendiste $ 1.080.000, +20% frente a $ 900.000; food cost 30%.', ['ventas', 'food_cost']), facts);
  assert.equal(v.ok, true);
});

test('verificación: detecta cifras inventadas e ids inexistentes', () => {
  const v = verifyReport(report('Vendiste $ 1.250.000 y el ticket subió 37%.', ['ventas', 'inventado']), facts);
  assert.equal(v.ok, false);
  assert.deepEqual(v.unknown_refs, ['inventado']);
  assert.deepEqual(v.unverified_numbers.map((n) => n.value), ['1.250.000', '37%']);
});

test('el esquema exige al menos un hallazgo con evidencia citada', () => {
  assert.equal(analystReportSchema.safeParse({ ...report('x', ['ventas']), findings: [] }).success, false);
  assert.equal(analystReportSchema.safeParse(report('Vendiste $ 1.080.000', ['ventas'])).success, true);
});
