import 'server-only';
import { type DaySales, mergeDays, monthlySales, rangeVsLastYear } from '@/lib/analytics/sales-history';
import type { RawBusinessSnapshot } from '@/lib/analytics/types';
import type { TenantContext } from '@/lib/tenant-context';

/** Fecha local AAAA-MM-DD del gastrobar. */
export function localDay(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

/** Instante UTC de la medianoche local de un día AAAA-MM-DD en la zona del gastrobar. */
export function localMidnight(day: string, timeZone: string): Date {
  const guess = new Date(`${day}T00:00:00Z`);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
      .formatToParts(guess)
      .map((p) => [p.type, p.value]),
  );
  const asLocal = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute));
  return new Date(guess.getTime() - (asLocal - guess.getTime()));
}

/** Tramo máximo por consulta al resumen del negocio (la función rechaza más de 366 días). */
const CHUNK_DAYS = 360;

export const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

async function historyDays(ctx: TenantContext, sinceDay: string) {
  const rows: Array<{ day: string; orders: number; revenue: number; source: string }> = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await ctx.supabase
      .from('sales_history_days')
      .select('day, orders, revenue, source')
      .eq('tenant_id', ctx.tenant.id)
      .gte('day', sinceDay)
      .order('day')
      .range(from, from + 999);
    if (error) throw error;
    rows.push(...data);
    if (data.length < 1000) return rows;
  }
}

/**
 * Ventas por día de los últimos `months` meses (y los mismos meses del año anterior):
 * historial importado + ventas de GastroBar después del último día del historial.
 */
export async function getSalesDays(ctx: TenantContext, months = 25) {
  const tz = ctx.tenant.timezone;
  const today = localDay(new Date(), tz);
  const since = `${Number(today.slice(0, 4)) - Math.ceil(months / 12)}${today.slice(4, 7)}-01`;
  const history = await historyDays(ctx, since);
  const historyUntil = history.at(-1)?.day ?? null;
  const historySource = history.at(-1)?.source ?? null;

  const liveFromDay = historyUntil ? addDays(historyUntil, 1) : since;
  // get_business_snapshot admite como máximo 366 días por consulta: se pide por tramos.
  const liveRows = new Map<string, DaySales>();
  const calls: Array<PromiseLike<void>> = [];
  for (let start = liveFromDay; start <= today; start = addDays(start, CHUNK_DAYS)) {
    const end = addDays(start, CHUNK_DAYS);
    const to = end > today ? new Date() : localMidnight(end, tz);
    calls.push(
      ctx.supabase
        .rpc('get_business_snapshot', { p_from: localMidnight(start, tz).toISOString(), p_to: to.toISOString() })
        .then(({ data, error }) => {
          if (error) throw error;
          for (const d of (data as unknown as RawBusinessSnapshot).daily) {
            const row = { day: String(d.date).slice(0, 10), orders: Number(d.orders), revenue: Number(d.revenue) };
            if (row.orders > 0 || row.revenue > 0) liveRows.set(row.day, row);
          }
        }),
    );
  }
  await Promise.all(calls);
  const live = [...liveRows.values()];
  const days = mergeDays(
    history.map((d) => ({ day: d.day, orders: Number(d.orders), revenue: Number(d.revenue) })),
    live,
  );
  return { days, today, historyUntil, historySource };
}

export async function getMonthlySales(ctx: TenantContext, months = 25) {
  const { days, today, historyUntil, historySource } = await getSalesDays(ctx, months);
  const all = monthlySales(days, today);
  return { months: all.slice(-months), today, historyUntil, historySource, days };
}

/** Los últimos `n` días (incluido hoy) contra los mismos días del año anterior. */
export function lastDaysVsLastYear(days: DaySales[], today: string, n: number) {
  return rangeVsLastYear(days, addDays(today, -(n - 1)), today);
}

/** Productos más vendidos de un mes del historial y del mismo mes del año anterior. */
export async function getHistoryProducts(ctx: TenantContext, month: string, limit = 30) {
  const prev = `${Number(month.slice(0, 4)) - 1}${month.slice(4, 7)}`;
  const { data, error } = await ctx.supabase
    .from('sales_history_products')
    .select('month, product_name, category, quantity, revenue')
    .eq('tenant_id', ctx.tenant.id)
    .in('month', [`${month}-01`, `${prev}-01`])
    .order('revenue', { ascending: false });
  if (error) throw error;
  const pick = (m: string) =>
    data
      .filter((r) => r.month.slice(0, 7) === m)
      .slice(0, limit)
      .map((r) => ({ name: r.product_name, category: r.category, quantity: Number(r.quantity), revenue: Math.round(Number(r.revenue)) }));
  return { month, products: pick(month), previous_year: { month: prev, products: pick(prev) } };
}
