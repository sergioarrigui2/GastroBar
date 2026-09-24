import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AI_PLANS, monthStart, pickAnalystModel, resolvePlan } from '../lib/ai/plans.ts';
import { analyzeSnapshot } from '../lib/analytics/analyze.ts';
import { buildBriefing, greeting } from '../lib/analytics/briefing.ts';
import type { RawBusinessSnapshot, SnapshotKpis } from '../lib/analytics/types.ts';
import { detectedValue } from '../lib/analytics/value.ts';

delete process.env.ANALYST_MODEL;
delete process.env.DEFAULT_AI_PLAN;

test('planes: por defecto Prueba; los ajustes del gastrobar reemplazan al catálogo', () => {
  assert.equal(resolvePlan(null).id, 'prueba');
  const pro = resolvePlan({ plan: 'pro', reports_per_month: null, monthly_budget_usd: null, model_tier: null });
  assert.deepEqual([pro.reportsPerMonth, pro.monthlyBudgetUsd, pro.tier], [10, 3, 'balanced']);
  const custom = resolvePlan({ plan: 'basico', reports_per_month: 15, monthly_budget_usd: 2.5, model_tier: 'premium' });
  assert.deepEqual([custom.label, custom.reportsPerMonth, custom.monthlyBudgetUsd, custom.tier], ['Básico', 15, 2.5, 'premium']);
  assert.equal(resolvePlan({ plan: 'inventado', reports_per_month: null, monthly_budget_usd: null, model_tier: null }).id, 'prueba');
  assert.equal(AI_PLANS.sin_ia.reportsPerMonth, 0);
});

test('enrutador: Haiku para lo simple, Sonnet para lo complejo según el plan', () => {
  const simple = { facts: 30, anomalies: 1, critical: 0, days: 7 };
  const complex = { facts: 55, anomalies: 4, critical: 1, days: 30 };
  assert.equal(pickAnalystModel('economy', complex).model, 'claude-haiku-4-5');
  assert.equal(pickAnalystModel('premium', simple).model, 'claude-sonnet-5');
  assert.equal(pickAnalystModel('balanced', simple).model, 'claude-haiku-4-5');
  assert.equal(pickAnalystModel('balanced', complex).model, 'claude-sonnet-5');
  assert.equal(pickAnalystModel('balanced', { ...simple, days: 90 }).model, 'claude-sonnet-5');
});

test('inicio de mes en la zona horaria del negocio', () => {
  // 1 de octubre 03:00 UTC = 30 de septiembre 22:00 en Bogotá: el mes local sigue siendo septiembre.
  assert.equal(monthStart('America/Bogota', new Date('2026-10-01T03:00:00Z')).toISOString(), '2026-09-01T05:00:00.000Z');
  assert.equal(monthStart('America/Bogota', new Date('2026-10-01T06:00:00Z')).toISOString(), '2026-10-01T05:00:00.000Z');
});

const kpis = (o: Partial<SnapshotKpis> = {}): SnapshotKpis => ({
  revenue: 0, net_revenue: 0, orders: 0, avg_ticket: 0, guests: 0, items_sold: 0, tips: 0, tax: 0, discounts: 0, comps: 0,
  ingredient_cost: 0, waste_cost: 0, shrinkage_cost: 0, voided_payments: 0, cancelled_items: 0, cancelled_value: 0, ...o,
});
const raw: RawBusinessSnapshot = {
  period: {
    from: '2026-09-01T05:00:00Z', to: '2026-09-24T05:00:00Z', previous_from: '2026-08-09T05:00:00Z', previous_to: '2026-09-01T05:00:00Z',
    days: 23, timezone: 'America/Bogota', currency: 'COP', kds_warning_minutes: 10, kds_late_minutes: 20,
  },
  kpis: kpis({ revenue: 10_000_000, net_revenue: 9_259_259, orders: 150, avg_ticket: 66_667, ingredient_cost: 2_700_000, waste_cost: 90_000, shrinkage_cost: 120_000 }),
  previous_kpis: kpis({ revenue: 10_000_000, net_revenue: 9_259_259, orders: 150 }),
  daily: [], weekdays: [], heatmap: [],
  products: [
    // Food cost 50%: con objetivo 35% sobran 15% de 1.000.000 = 150.000.
    { product_id: 'h', name: 'Hamburguesa', category: 'Platos', station: 'kitchen', quantity: 50, comped_quantity: 0, revenue: 1_080_000, net_revenue: 1_000_000, cost: 500_000, comped_cost: 0 },
    { product_id: 'm', name: 'Mojito', category: 'Cócteles', station: 'bar', quantity: 100, comped_quantity: 0, revenue: 2_160_000, net_revenue: 2_000_000, cost: 500_000, comped_cost: 0 },
  ],
  unsold_products: [], categories: [],
  staff: [
    { profile_id: 'a', name: 'Ana', role: 'waiter', orders: 75, revenue: 5_000_000, avg_ticket: 66_667, discounts: 400_000, discounted_orders: 20, comps: 100_000, voided_payments: 0 },
    { profile_id: 'b', name: 'Beto', role: 'waiter', orders: 75, revenue: 5_000_000, avg_ticket: 66_667, discounts: 0, discounted_orders: 0, comps: 0, voided_payments: 0 },
  ],
  stations: [], table_minutes: null, payments: {}, channels: {},
  cash: { sessions: 20, total_difference: -30_000, differences: [{ closed_at: '2026-09-10T06:00:00Z', difference: -50_000, closed_by: 'Beto' }, { closed_at: '2026-09-11T06:00:00Z', difference: 20_000, closed_by: 'Ana' }] },
  inventory: { stock_value: 0, low_stock: [], usage: [] },
};

test('plata detectada: sólo cifras exactas, sin contar sobrantes de caja', () => {
  const v = detectedValue(analyzeSnapshot(raw));
  const by = Object.fromEntries(v.items.map((i) => [i.key, i.amount]));
  assert.equal(by.cash, 50_000);
  assert.equal(by.shrinkage, 120_000);
  assert.equal(by.waste, 90_000);
  assert.equal(by.food_cost, 150_000);
  // Ana entrega 500.000 sobre 5.000.000 (10%); el equipo 5% → exceso de 250.000.
  assert.equal(by.discounts, 250_000);
  assert.equal(v.total, 660_000);
});

test('resumen del día: prioriza el informe reciente, completa con alertas y no llama al modelo', () => {
  const a = analyzeSnapshot(raw);
  const report = {
    created_at: '2026-09-22T12:00:00Z',
    content: {
      headline: 'x', health: 'watch' as const, summary: 'x'.repeat(50), highlights: [], menu_actions: [], questions: [],
      findings: [
        { title: 'Oportunidad en cócteles', severity: 'opportunity' as const, evidence: '', evidence_refs: ['p1'], impact: '', action: 'Promociona el mojito' },
        { title: 'Faltante en cierre de caja', severity: 'critical' as const, evidence: '', evidence_refs: ['caja_1'], impact: '', action: 'Revisa el cierre del 10' },
      ],
    },
  };
  const now = new Date('2026-09-24T12:00:00Z');
  const items = buildBriefing({ report, anomalies: a.anomalies, now });
  assert.equal(items.length, 3);
  assert.equal(items[0]!.title, 'Faltante en cierre de caja');
  assert.equal(items[0]!.source, 'analista');
  const old = buildBriefing({ report: { ...report, created_at: '2026-09-01T00:00:00Z' }, anomalies: a.anomalies, now });
  assert.ok(old.every((i) => i.source === 'reglas'));
  assert.equal(greeting('America/Bogota', new Date('2026-09-24T13:00:00Z')), 'Buenos días');
});
