import { THRESHOLDS } from './analyze.ts';
import type { BusinessAnalysis } from './types';

/**
 * "Plata detectada": dinero en riesgo que los agentes pusieron a la vista, calculado
 * sólo con cifras exactas del sistema (nunca con estimaciones del modelo), para que
 * el número sea defendible frente al dueño.
 */
export type DetectedItem = { key: string; label: string; amount: number; detail: string };

/** Food cost objetivo con el que se mide el sobrecosto de un producto. */
export const TARGET_FOOD_COST_PCT = 35;

export function detectedValue(a: BusinessAnalysis): { total: number; items: DetectedItem[] } {
  const s = a.snapshot;
  const items: DetectedItem[] = [];

  const shortfalls = s.cash.differences.map((d) => Number(d.difference)).filter((d) => d < 0);
  if (shortfalls.length) {
    items.push({
      key: 'cash',
      label: 'Faltantes en cierres de caja',
      amount: -shortfalls.reduce((x, y) => x + y, 0),
      detail: `${shortfalls.length} cierre(s) con faltante`,
    });
  }

  if (s.kpis.shrinkage_cost > 0) {
    items.push({
      key: 'shrinkage',
      label: 'Faltantes de inventario',
      amount: Number(s.kpis.shrinkage_cost),
      detail: 'Ajustes negativos al contar (producto que no cuadra con ventas ni mermas)',
    });
  }

  if (s.kpis.waste_cost > 0) {
    items.push({ key: 'waste', label: 'Mermas registradas', amount: Number(s.kpis.waste_cost), detail: 'Desperdicio con motivo' });
  }

  const overrun = a.menu.products
    .filter((p) => p.food_cost_pct !== null && p.food_cost_pct > THRESHOLDS.productFoodCost)
    .map((p) => ({ name: p.name, extra: p.cost - (p.net_revenue * TARGET_FOOD_COST_PCT) / 100 }))
    .filter((p) => p.extra > 0);
  if (overrun.length) {
    items.push({
      key: 'food_cost',
      label: 'Sobrecosto en productos caros de producir',
      amount: Math.round(overrun.reduce((x, p) => x + p.extra, 0)),
      detail: `${overrun.map((p) => p.name).join(', ')} frente a un food cost objetivo de ${TARGET_FOOD_COST_PCT}%`,
    });
  }

  const staff = s.staff.map((w) => ({ ...w, revenue: Number(w.revenue), given: Number(w.discounts) + Number(w.comps) }));
  const teamRevenue = staff.reduce((x, w) => x + w.revenue, 0);
  const teamRate = teamRevenue > 0 ? staff.reduce((x, w) => x + w.given, 0) / teamRevenue : 0;
  const flagged = new Set(a.anomalies.filter((x) => x.kind === 'staff_discounts').map((x) => x.id.split(':')[1]));
  const excess = staff
    .filter((w) => flagged.has(w.profile_id ?? 'none'))
    .map((w) => ({ name: w.name, extra: w.given - w.revenue * teamRate }))
    .filter((w) => w.extra > 0);
  if (excess.length) {
    items.push({
      key: 'discounts',
      label: 'Descuentos y cortesías por encima del promedio',
      amount: Math.round(excess.reduce((x, w) => x + w.extra, 0)),
      detail: excess.map((w) => w.name).join(', '),
    });
  }

  return { total: items.reduce((x, i) => x + i.amount, 0), items };
}
