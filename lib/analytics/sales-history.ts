/**
 * Ventas por mes juntando el historial importado (resumen diario) con las ventas
 * hechas en GastroBar. Un día cuenta de una sola fuente: hasta el último día del
 * historial manda el historial; después, GastroBar. Así no se duplica nada si las
 * dos fuentes se solapan durante el cambio de sistema.
 */

export type DaySales = { day: string; orders: number; revenue: number };

export type MonthSales = {
  /** AAAA-MM */
  month: string;
  orders: number;
  revenue: number;
  /** Días con ventas registradas en el mes. */
  days: number;
  source: 'history' | 'live' | 'mixed';
  /** El mes en curso: todavía no está completo. */
  partial: boolean;
  previous_year: { revenue: number; orders: number } | null;
  /** Cambio contra el mismo mes del año anterior, en % (null si no hay con qué comparar). En el mes en curso, contra los mismos días. */
  change_pct: number | null;
};

export function mergeDays(history: DaySales[], live: DaySales[]): Array<DaySales & { source: 'history' | 'live' }> {
  const until = history.reduce<string | null>((max, d) => (max === null || d.day > max ? d.day : max), null);
  const out = new Map<string, DaySales & { source: 'history' | 'live' }>();
  for (const d of history) out.set(d.day, { ...d, source: 'history' });
  for (const d of live) {
    if (until !== null && d.day <= until) continue;
    if (d.orders === 0 && d.revenue === 0) continue;
    out.set(d.day, { ...d, source: 'live' });
  }
  return [...out.values()].sort((a, b) => a.day.localeCompare(b.day));
}

const pct = (current: number, previous: number) => (previous > 0 ? Math.round(((current - previous) / previous) * 1000) / 10 : null);

/** Agrupa por mes y compara con el mismo mes del año anterior. `today` = fecha local AAAA-MM-DD. */
export function monthlySales(days: Array<DaySales & { source: 'history' | 'live' }>, today: string): MonthSales[] {
  const byMonth = new Map<string, { orders: number; revenue: number; days: number; sources: Set<string> }>();
  for (const d of days) {
    const m = d.day.slice(0, 7);
    const cur = byMonth.get(m) ?? { orders: 0, revenue: 0, days: 0, sources: new Set<string>() };
    cur.orders += d.orders;
    cur.revenue += d.revenue;
    cur.days += 1;
    cur.sources.add(d.source);
    byMonth.set(m, cur);
  }
  const currentMonth = today.slice(0, 7);
  // El mes en curso se compara contra los mismos días del año anterior (del 1 a hoy), no contra el mes completo.
  const sameDaysLastYear = (month: string) => {
    const prevMonth = `${Number(month.slice(0, 4)) - 1}${month.slice(4)}`;
    const lastDay = `${prevMonth}-${today.slice(8, 10)}`;
    const sel = days.filter((d) => d.day.startsWith(prevMonth) && d.day <= lastDay);
    return sel.length ? { orders: sel.reduce((s, d) => s + d.orders, 0), revenue: sel.reduce((s, d) => s + d.revenue, 0) } : undefined;
  };
  return [...byMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, v]) => {
      const prevKey = `${Number(month.slice(0, 4)) - 1}${month.slice(4)}`;
      const prev = month === currentMonth ? sameDaysLastYear(month) : byMonth.get(prevKey);
      return {
        month,
        orders: v.orders,
        revenue: Math.round(v.revenue),
        days: v.days,
        source: v.sources.size > 1 ? 'mixed' : (([...v.sources][0] as 'history' | 'live') ?? 'live'),
        partial: month === currentMonth,
        previous_year: prev ? { revenue: Math.round(prev.revenue), orders: prev.orders } : null,
        change_pct: prev ? pct(v.revenue, prev.revenue) : null,
      };
    });
}

/** Venta de un rango de días [from, to] (AAAA-MM-DD, inclusive) y del mismo rango un año antes. */
export function rangeVsLastYear(days: DaySales[], from: string, to: string) {
  const shift = (d: string) => `${Number(d.slice(0, 4)) - 1}${d.slice(4)}`;
  const sum = (a: string, b: string) =>
    days.filter((d) => d.day >= a && d.day <= b).reduce((s, d) => ({ orders: s.orders + d.orders, revenue: s.revenue + d.revenue }), { orders: 0, revenue: 0 });
  const current = sum(from, to);
  const previous = sum(shift(from), shift(to));
  return { current, previous, change_pct: pct(current.revenue, previous.revenue) };
}
