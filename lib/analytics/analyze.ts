import type {
  AnalyzedProduct,
  Anomaly,
  BusinessAnalysis,
  KpiChange,
  MenuClass,
  RawBusinessSnapshot,
  SnapshotKpis,
} from './types';

export const WEEKDAYS = ['', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'] as const;

export const MENU_CLASS_LABEL: Record<MenuClass, string> = {
  star: 'Estrella',
  plowhorse: 'Caballo de batalla',
  puzzle: 'Enigma',
  dog: 'Perro',
};

/** Umbrales de las reglas de anomalías; ajustables sin tocar el SQL. */
export const THRESHOLDS = {
  revenueDropWarn: -15,
  revenueDropCritical: -30,
  foodCostWarn: 35,
  foodCostCritical: 45,
  foodCostRisePoints: 5,
  productFoodCost: 40,
  productMinQuantity: 3,
  shrinkagePct: 10,
  wastePct: 5,
  staffMinOrders: 5,
  staffDiscountRatio: 2,
  staffDiscountMinPct: 5,
  staffVoids: 2,
  stationLateWarn: 15,
  stationLateCritical: 30,
  unusualDayZ: 2.5,
  unusualDayMinDays: 14,
} as const;

const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;
const pct = (part: number, whole: number) => (whole > 0 ? round((part / whole) * 100, 1) : null);

function changeOf(current: number, previous: number): KpiChange {
  return { current, previous, change_pct: previous !== 0 ? round(((current - previous) / Math.abs(previous)) * 100, 1) : null };
}

/** Normaliza números (PostgREST puede devolver numeric como string en algunos drivers). */
function toNumbers<T extends Record<string, unknown>>(row: T): T {
  const out: Record<string, unknown> = { ...row };
  for (const [k, v] of Object.entries(out)) if (typeof v === 'string' && v !== '' && !Number.isNaN(Number(v)) && k !== 'name') out[k] = Number(v);
  return out as T;
}

export function classifyMenu(snapshot: RawBusinessSnapshot): BusinessAnalysis['menu'] {
  const sold = snapshot.products.map(toNumbers).filter((p) => p.quantity > 0);
  const totalQty = sold.reduce((s, p) => s + p.quantity, 0);
  const totalMargin = sold.reduce((s, p) => s + (p.net_revenue - p.cost), 0);
  const avgUnitMargin = totalQty > 0 ? totalMargin / totalQty : 0;
  // Regla 70 %: un plato es "popular" si su participación supera el 70 % de la participación media.
  const popularityThreshold = sold.length > 0 ? (100 / sold.length) * 0.7 : 0;

  const products: AnalyzedProduct[] = sold.map((p) => {
    const margin = p.net_revenue - p.cost;
    const unitMargin = margin / p.quantity;
    const mixPct = totalQty > 0 ? (p.quantity / totalQty) * 100 : 0;
    const popular = mixPct >= popularityThreshold;
    const profitable = unitMargin >= avgUnitMargin;
    const cls: MenuClass = popular ? (profitable ? 'star' : 'plowhorse') : profitable ? 'puzzle' : 'dog';
    return {
      ...p,
      margin: round(margin),
      unit_margin: round(unitMargin),
      food_cost_pct: p.cost > 0 ? pct(p.cost, p.net_revenue) : null,
      mix_pct: round(mixPct, 1),
      class: cls,
    };
  });

  return { products, popularity_threshold_pct: round(popularityThreshold, 1), avg_unit_margin: round(avgUnitMargin) };
}

export type Money = (amount: number) => string;
const defaultMoney: Money = (n) => new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 }).format(n);

export function detectAnomalies(
  snapshot: RawBusinessSnapshot,
  changes: BusinessAnalysis['changes'],
  ratios: BusinessAnalysis['ratios'],
  menu: BusinessAnalysis['menu'],
  money: Money = defaultMoney,
): Anomaly[] {
  const T = THRESHOLDS;
  const out: Anomaly[] = [];
  const k = snapshot.kpis;

  const rev = changes.revenue;
  if (rev.previous > 0 && rev.change_pct !== null && rev.change_pct <= T.revenueDropWarn) {
    out.push({
      id: 'revenue_drop',
      kind: 'revenue_drop',
      severity: rev.change_pct <= T.revenueDropCritical ? 'critical' : 'warning',
      title: 'Las ventas bajaron frente al periodo anterior',
      detail: `Vendiste ${money(rev.current)} frente a ${money(rev.previous)} del periodo anterior (${rev.change_pct}%).`,
      value: rev.current,
      baseline: rev.previous,
    });
  }

  if (ratios.food_cost_pct !== null && ratios.food_cost_pct > T.foodCostWarn) {
    out.push({
      id: 'food_cost_high',
      kind: 'food_cost_high',
      severity: ratios.food_cost_pct > T.foodCostCritical ? 'critical' : 'warning',
      title: 'Food cost por encima de lo sano',
      detail: `El costo de insumos es ${ratios.food_cost_pct}% de la venta sin impuestos (referencia: 28–35%).`,
      value: ratios.food_cost_pct,
      baseline: T.foodCostWarn,
    });
  } else if (
    ratios.food_cost_pct !== null &&
    ratios.prev_food_cost_pct !== null &&
    ratios.food_cost_pct - ratios.prev_food_cost_pct >= T.foodCostRisePoints
  ) {
    out.push({
      id: 'food_cost_high',
      kind: 'food_cost_high',
      severity: 'warning',
      title: 'El food cost subió',
      detail: `Pasó de ${ratios.prev_food_cost_pct}% a ${ratios.food_cost_pct}%.`,
      value: ratios.food_cost_pct,
      baseline: ratios.prev_food_cost_pct,
    });
  }

  const expensive = menu.products
    .filter((p) => p.quantity >= T.productMinQuantity && p.food_cost_pct !== null && p.food_cost_pct > T.productFoodCost)
    .sort((a, b) => (b.food_cost_pct ?? 0) - (a.food_cost_pct ?? 0));
  if (expensive.length > 0) {
    out.push({
      id: 'product_food_cost',
      kind: 'product_food_cost',
      severity: 'warning',
      title:
        expensive.length === 1
          ? `${expensive[0]!.name}: costo alto frente a su precio`
          : `${expensive.length} productos cuestan más del ${T.productFoodCost}% de su precio`,
      detail: expensive
        .slice(0, 6)
        .map((p) => `${p.name} ${p.food_cost_pct}%`)
        .join(' · '),
      value: expensive[0]!.food_cost_pct ?? 0,
      baseline: T.productFoodCost,
    });
  }

  for (const u of snapshot.inventory.usage.map(toNumbers)) {
    const moved = u.sold + u.waste + u.shrinkage;
    const shrink = moved > 0 ? (u.shrinkage / moved) * 100 : 0;
    if (u.shrinkage > 0 && shrink >= T.shrinkagePct) {
      out.push({
        id: `shrinkage:${u.ingredient_id}`,
        kind: 'shrinkage',
        severity: shrink >= T.shrinkagePct * 2 ? 'critical' : 'warning',
        title: `${u.name}: faltantes en ajustes de inventario`,
        detail: `${round(shrink, 1)}% de lo que salió de ${u.name} fue por ajustes negativos (conteos que no cuadran), no por ventas ni mermas registradas.`,
        value: round(shrink, 1),
        baseline: T.shrinkagePct,
      });
    }
  }

  const wastePct = pct(k.waste_cost, k.ingredient_cost + k.waste_cost);
  if (wastePct !== null && wastePct >= T.wastePct) {
    out.push({
      id: 'waste',
      kind: 'waste',
      severity: 'warning',
      title: 'Mermas altas',
      detail: `Las mermas registradas son ${wastePct}% del costo total de insumos.`,
      value: wastePct,
      baseline: T.wastePct,
    });
  }

  snapshot.cash.differences.forEach((d, i) => {
    const diff = Number(d.difference);
    out.push({
      id: `cash_difference:${i}`,
      kind: 'cash_difference',
      severity: Math.abs(diff) >= Math.max(k.avg_ticket, 1) ? 'critical' : 'warning',
      title: diff < 0 ? 'Faltante en un cierre de caja' : 'Sobrante en un cierre de caja',
      detail: `Diferencia de ${money(diff)} al cerrar${d.closed_by ? ` (${d.closed_by})` : ''}.`,
      value: diff,
      baseline: 0,
    });
  });

  const staff = snapshot.staff.map(toNumbers);
  const totalRevenue = staff.reduce((s, w) => s + w.revenue, 0);
  const totalGiven = staff.reduce((s, w) => s + w.discounts + w.comps, 0);
  const overallRate = totalRevenue > 0 ? (totalGiven / totalRevenue) * 100 : 0;
  for (const w of staff) {
    if (w.orders < T.staffMinOrders || w.revenue <= 0) continue;
    const rate = ((w.discounts + w.comps) / w.revenue) * 100;
    if (rate >= T.staffDiscountMinPct && rate >= overallRate * T.staffDiscountRatio) {
      out.push({
        id: `staff_discounts:${w.profile_id ?? 'none'}`,
        kind: 'staff_discounts',
        severity: 'warning',
        title: `${w.name}: más descuentos y cortesías que el promedio`,
        detail: `${round(rate, 1)}% de sus ventas vs. ${round(overallRate, 1)}% del equipo.`,
        value: round(rate, 1),
        baseline: round(overallRate, 1),
      });
    }
    if (w.voided_payments >= T.staffVoids) {
      out.push({
        id: `staff_voids:${w.profile_id ?? 'none'}`,
        kind: 'staff_voids',
        severity: 'warning',
        title: `${w.name}: pagos anulados en sus mesas`,
        detail: `${w.voided_payments} pagos anulados en el periodo.`,
        value: w.voided_payments,
        baseline: T.staffVoids,
      });
    }
  }

  for (const s of snapshot.stations.map(toNumbers)) {
    if (s.pct_late >= T.stationLateWarn) {
      out.push({
        id: `station_delays:${s.station}`,
        kind: 'station_delays',
        severity: s.pct_late >= T.stationLateCritical ? 'critical' : 'warning',
        title: `${s.station === 'bar' ? 'Barra' : 'Cocina'}: muchas comandas demoradas`,
        detail: `${s.pct_late}% superó los ${snapshot.period.kds_late_minutes} min (promedio ${s.avg_minutes} min, p90 ${s.p90_minutes} min).`,
        value: s.pct_late,
        baseline: T.stationLateWarn,
      });
    }
  }

  if (snapshot.inventory.low_stock.length > 0) {
    out.push({
      id: 'low_stock',
      kind: 'low_stock',
      severity: 'info',
      title: `${snapshot.inventory.low_stock.length} insumo(s) en o bajo el mínimo`,
      detail: snapshot.inventory.low_stock.map((i) => i.name).join(', '),
      value: snapshot.inventory.low_stock.length,
    });
  }

  const withSales = snapshot.daily.map(toNumbers).filter((d) => d.orders > 0);
  if (snapshot.period.days >= T.unusualDayMinDays && withSales.length >= 7) {
    const mean = withSales.reduce((s, d) => s + d.revenue, 0) / withSales.length;
    const sd = Math.sqrt(withSales.reduce((s, d) => s + (d.revenue - mean) ** 2, 0) / withSales.length);
    if (sd > 0) {
      for (const d of withSales) {
        const z = (d.revenue - mean) / sd;
        if (Math.abs(z) >= T.unusualDayZ) {
          out.push({
            id: `unusual_day:${d.date}`,
            kind: 'unusual_day',
            severity: 'info',
            title: `Día ${z > 0 ? 'excepcionalmente alto' : 'excepcionalmente bajo'}: ${d.date}`,
            detail: `Vendió ${money(d.revenue)} frente a un promedio diario de ${money(mean)}.`,
            value: d.revenue,
            baseline: round(mean),
          });
        }
      }
    }
  }

  const order = { critical: 0, warning: 1, info: 2 } as const;
  return out.sort((a, b) => order[a.severity] - order[b.severity]);
}

/** Enriquece el resumen SQL con variaciones, ingeniería de menú, horarios y anomalías. */
export function analyzeSnapshot(raw: RawBusinessSnapshot, money: Money = defaultMoney): BusinessAnalysis {
  const snapshot: RawBusinessSnapshot = {
    ...raw,
    kpis: toNumbers(raw.kpis),
    previous_kpis: toNumbers(raw.previous_kpis),
  };
  const k = snapshot.kpis;
  const p = snapshot.previous_kpis;

  const changes = Object.fromEntries(
    (Object.keys(k) as Array<keyof SnapshotKpis>).map((key) => [key, changeOf(k[key], p[key])]),
  ) as BusinessAnalysis['changes'];

  const ratios: BusinessAnalysis['ratios'] = {
    food_cost_pct: pct(k.ingredient_cost, k.net_revenue),
    prev_food_cost_pct: pct(p.ingredient_cost, p.net_revenue),
    discount_pct: pct(k.discounts, k.revenue + k.discounts),
    comp_pct: pct(k.comps, k.revenue + k.comps),
    revenue_per_guest: k.guests > 0 ? round(k.revenue / k.guests) : null,
    avg_daily_revenue: snapshot.period.days > 0 ? round(k.revenue / snapshot.period.days) : 0,
  };

  const menu = classifyMenu(snapshot);

  const weekdays = snapshot.weekdays.map(toNumbers).map((w) => ({
    dow: w.dow,
    label: WEEKDAYS[w.dow] ?? String(w.dow),
    days: w.days,
    avg_revenue: w.days > 0 ? round(w.revenue / w.days) : 0,
    avg_orders: w.days > 0 ? round(w.orders / w.days, 1) : 0,
  }));

  const peak_hours = [...snapshot.heatmap.map(toNumbers)]
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 5)
    .map((h) => ({ ...h, label: `${WEEKDAYS[h.dow] ?? h.dow} ${String(h.hour).padStart(2, '0')}:00` }));

  return {
    snapshot,
    changes,
    ratios,
    menu,
    weekdays,
    peak_hours,
    anomalies: detectAnomalies(snapshot, changes, ratios, menu, money),
  };
}
