import { MENU_CLASS_LABEL } from '../analytics/analyze.ts';
import type { BusinessAnalysis, KpiChange } from '../analytics/types';

/**
 * Hechos verificables que se le entregan al modelo. Cada uno tiene un id corto
 * que el modelo debe citar como evidencia; todas las cifras vienen ya calculadas
 * y formateadas, así el modelo interpreta pero nunca calcula.
 */
export type Fact = { id: string; text: string };

export type FactFormat = {
  money: (n: number) => string;
  /** Fecha local (YYYY-MM-DD) de un instante, en la zona horaria del negocio. */
  date: (iso: string) => string;
};

const pct = (n: number | null | undefined) => (n === null || n === undefined ? 's/d' : `${n}%`);

export function buildFacts(a: BusinessAnalysis, f: FactFormat): Fact[] {
  const s = a.snapshot;
  const facts: Fact[] = [];
  const add = (id: string, text: string) => facts.push({ id, text });
  const change = (c: KpiChange, fmt: (n: number) => string) =>
    `${fmt(c.current)} (anterior ${fmt(c.previous)}${c.change_pct === null ? '' : `, ${c.change_pct > 0 ? '+' : ''}${c.change_pct}%`})`;
  const int = (n: number) => String(Math.round(n));

  add('periodo', `Periodo ${f.date(s.period.from)} a ${f.date(s.period.to)} (${s.period.days} días), comparado con ${f.date(s.period.previous_from)} a ${f.date(s.period.previous_to)}. Moneda ${s.period.currency}.`);
  add('ventas', `Ventas totales (con impuestos): ${change(a.changes.revenue, f.money)}`);
  add('ventas_netas', `Ventas sin impuestos: ${change(a.changes.net_revenue, f.money)}`);
  add('cuentas', `Cuentas cerradas: ${change(a.changes.orders, int)}`);
  add('ticket', `Ticket promedio: ${change(a.changes.avg_ticket, f.money)}`);
  add('personas', `Personas atendidas: ${change(a.changes.guests, int)}; venta por persona ${a.ratios.revenue_per_guest === null ? 's/d' : f.money(a.ratios.revenue_per_guest)}`);
  add('venta_diaria', `Venta promedio por día: ${f.money(a.ratios.avg_daily_revenue)}`);
  add('propinas', `Propinas: ${change(a.changes.tips, f.money)}`);
  add('food_cost', `Food cost (insumos / venta sin impuestos): ${pct(a.ratios.food_cost_pct)} (anterior ${pct(a.ratios.prev_food_cost_pct)}); costo de insumos ${change(a.changes.ingredient_cost, f.money)}`);
  const margin = s.kpis.net_revenue - s.kpis.ingredient_cost;
  const prevMargin = s.previous_kpis.net_revenue - s.previous_kpis.ingredient_cost;
  add('margen_bruto', `Margen bruto (venta sin impuestos − insumos): ${f.money(margin)} (anterior ${f.money(prevMargin)})`);
  add('descuentos', `Descuentos: ${change(a.changes.discounts, f.money)} = ${pct(a.ratios.discount_pct)} de la venta bruta`);
  add('cortesias', `Cortesías: ${change(a.changes.comps, f.money)} = ${pct(a.ratios.comp_pct)} de la venta bruta`);
  add('mermas', `Mermas registradas: ${change(a.changes.waste_cost, f.money)}; faltantes por ajustes de inventario: ${change(a.changes.shrinkage_cost, f.money)}`);
  add('anulaciones', `Pagos anulados: ${change(a.changes.voided_payments, int)}; ítems cancelados: ${int(s.kpis.cancelled_items)} por ${f.money(s.kpis.cancelled_value)}`);

  a.weekdays.forEach((w) =>
    add(`dia_${w.dow}`, `${w.label}: promedio ${f.money(w.avg_revenue)} y ${w.avg_orders} cuentas por día (${w.days} ${w.label.toLowerCase()}s en el periodo)`),
  );
  a.peak_hours.forEach((h, i) => add(`pico_${i + 1}`, `Hora pico #${i + 1}: ${h.label}, ${f.money(h.revenue)} en ${h.orders} cuentas acumuladas`));

  add('menu_umbral', `Ingeniería de menú: margen unitario promedio ${f.money(a.menu.avg_unit_margin)}; un producto es popular si su mix supera ${a.menu.popularity_threshold_pct}%`);
  a.menu.products.slice(0, 25).forEach((p, i) =>
    add(
      `p${i + 1}`,
      `${p.name} [${MENU_CLASS_LABEL[p.class]}] (${p.category ?? 'sin categoría'}, ${p.station === 'bar' ? 'barra' : 'cocina'}): ${p.quantity} vendidos, mix ${p.mix_pct}%, venta ${f.money(p.revenue)}, margen unitario ${f.money(p.unit_margin)}, margen total ${f.money(p.margin)}, food cost ${pct(p.food_cost_pct)}${p.comped_quantity > 0 ? `, ${p.comped_quantity} en cortesía` : ''}`,
    ),
  );
  if (s.unsold_products.length) add('sin_ventas', `Productos activos sin ventas en el periodo: ${s.unsold_products.map((p) => p.name).join(', ')}`);

  s.staff.forEach((w, i) =>
    add(
      `e${i + 1}`,
      `${w.name}${w.role ? ` (${w.role})` : ''}: ${w.orders} cuentas, ventas ${f.money(Number(w.revenue))}, ticket ${f.money(Number(w.avg_ticket))}, descuentos ${f.money(Number(w.discounts))} en ${w.discounted_orders} cuentas, cortesías ${f.money(Number(w.comps))}, pagos anulados ${w.voided_payments}`,
    ),
  );

  s.stations.forEach((st) =>
    add(
      `estacion_${st.station}`,
      `${st.station === 'bar' ? 'Barra' : 'Cocina'}: ${st.items} ítems, preparación promedio ${st.avg_minutes} min, 90% en ${st.p90_minutes} min o menos, ${st.pct_warning}% pasó de ${s.period.kds_warning_minutes} min y ${st.pct_late}% pasó de ${s.period.kds_late_minutes} min`,
    ),
  );
  if (s.table_minutes !== null) add('duracion_mesa', `Una mesa permanece abierta en promedio ${s.table_minutes} min`);

  const payTotal = Object.values(s.payments).reduce((x, y) => x + Number(y ?? 0), 0);
  if (payTotal > 0) {
    const names: Record<string, string> = { cash: 'efectivo', card: 'tarjeta', transfer: 'transferencia', other: 'otro' };
    add('pagos', `Medios de pago: ${Object.entries(s.payments).map(([m, v]) => `${names[m] ?? m} ${f.money(Number(v))} (${Math.round((Number(v) / payTotal) * 100)}%)`).join(', ')}`);
  }
  const channels = Object.entries(s.channels);
  if (channels.length > 1) {
    const names: Record<string, string> = { pos: 'meseros', qr: 'menú QR', ai_agent: 'agente IA' };
    add('canales', `Canales: ${channels.map(([c, v]) => `${names[c] ?? c} ${v?.orders ?? 0} cuentas / ${f.money(Number(v?.revenue ?? 0))}`).join(', ')}`);
  }

  add('caja', `Cierres de caja: ${s.cash.sessions}, diferencia neta ${f.money(Number(s.cash.total_difference))}`);
  s.cash.differences.forEach((d, i) => add(`caja_${i + 1}`, `Cierre del ${f.date(d.closed_at)} por ${d.closed_by ?? 'sin nombre'}: diferencia ${f.money(Number(d.difference))}`));

  add('inventario', `Valor del inventario hoy: ${f.money(Number(s.inventory.stock_value))}; bajo el mínimo: ${s.inventory.low_stock.length ? s.inventory.low_stock.map((i) => `${i.name} (${i.stock} de mínimo ${i.min} ${i.unit})`).join(', ') : 'ninguno'}`);
  s.inventory.usage.slice(0, 12).forEach((u, i) =>
    add(`i${i + 1}`, `${u.name}: salió por ventas ${u.sold} ${u.unit}, mermas ${u.waste} ${u.unit}, faltantes por ajuste ${u.shrinkage} ${u.unit}; costo ${f.money(Number(u.cost))}`),
  );

  a.anomalies.forEach((x) =>
    add(`a:${x.id}`, `ALERTA ${x.severity === 'critical' ? 'CRÍTICA' : x.severity === 'warning' ? 'de atención' : 'informativa'}: ${x.title}. ${x.detail}`),
  );

  return facts;
}

export function factsToPrompt(facts: Fact[]): string {
  return facts.map((f) => `[${f.id}] ${f.text}`).join('\n');
}

