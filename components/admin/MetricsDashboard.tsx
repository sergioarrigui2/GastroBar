'use client';

import { AlertTriangle, Radio, WifiOff } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Card } from '@/components/ui/primitives';
import { useRealtimeRefresh } from '@/components/ui/useRealtimeRefresh';
import { cn, formatCurrency, formatDateTime, formatQuantity } from '@/lib/utils';
import type { MeasureUnit } from '@/types/database';
import type { PaymentMethod, ShiftMetrics } from '@/types/domain';

const METHOD_LABELS: Record<PaymentMethod, string> = {
  card: 'Tarjeta',
  cash: 'Efectivo',
  transfer: 'Transferencia',
  other: 'Otro',
};

export function MetricsDashboard({
  tenantId,
  currency,
  locale,
  timezone,
  range,
  ranges,
  metrics,
  lowStock,
}: {
  tenantId: string;
  currency: string;
  locale: string;
  timezone: string;
  range: string;
  ranges: Array<{ key: string; label: string }>;
  metrics: ShiftMetrics;
  lowStock: Array<{ id: string; name: string; stock: number; min: number; unit: MeasureUnit }>;
}) {
  const router = useRouter();
  const money = (n: number) => formatCurrency(n, currency, locale);

  // Métricas en tiempo real: cualquier pago, cambio de orden o de stock re-renderiza el servidor.
  const realtime = useRealtimeRefresh({
    channel: `dashboard:${tenantId}`,
    subscriptions: [
      { table: 'payments', event: 'INSERT', filter: `tenant_id=eq.${tenantId}` },
      { table: 'orders', filter: `tenant_id=eq.${tenantId}` },
      { table: 'ingredients', event: 'UPDATE', filter: `tenant_id=eq.${tenantId}` },
    ],
    onRefresh: () => router.refresh(),
    debounceMs: 1500,
  });

  const margin = metrics.revenue > 0 ? ((metrics.revenue - metrics.ingredient_cost) / metrics.revenue) * 100 : null;
  const foodCost = metrics.revenue > 0 ? (metrics.ingredient_cost / metrics.revenue) * 100 : null;
  const maxQty = Math.max(1, ...metrics.top_products.map((p) => p.quantity));
  const maxHour = Math.max(1, ...metrics.hourly_revenue.map((h) => h.revenue));
  const methodTotal = Object.values(metrics.payments_by_method).reduce((a, b) => a + (b ?? 0), 0);
  const hourFmt = { format: (d: Date) => formatDateTime(d, locale, timezone, { hour: '2-digit', minute: '2-digit' }) };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="mr-auto text-2xl font-bold">Métricas</h1>
        <span
          className={cn(
            'flex items-center gap-1.5 text-xs font-semibold',
            realtime === 'live' ? 'text-emerald-600' : 'text-amber-600',
          )}
        >
          {realtime === 'live' ? <Radio className="size-4" /> : <WifiOff className="size-4" />}
          {realtime === 'live' ? 'Tiempo real' : 'Reconectando'}
        </span>
        <nav aria-label="Periodo" className="flex gap-1 rounded-xl bg-zinc-100 p-1 dark:bg-zinc-900">
          {ranges.map((r) => (
            <Link
              key={r.key}
              href={r.key === 'shift' ? '/admin' : `/admin?range=${r.key}`}
              aria-current={range === r.key ? 'page' : undefined}
              className={cn(
                'rounded-lg px-3 py-1.5 text-sm font-semibold',
                range === r.key ? 'bg-white shadow dark:bg-zinc-800' : 'text-zinc-500',
              )}
            >
              {r.label}
            </Link>
          ))}
        </nav>
      </div>

      {/* KPIs */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Kpi label="Ventas" value={money(metrics.revenue)} hint={`+ ${money(metrics.tips)} propinas`} />
        <Kpi label="Ticket promedio" value={money(metrics.avg_ticket)} hint={`${metrics.orders_closed} cuentas cerradas`} />
        <Kpi
          label="Costo de insumos"
          value={money(metrics.ingredient_cost)}
          hint={foodCost === null ? 'Sin ventas' : `${foodCost.toFixed(1)}% de ventas · margen ${margin?.toFixed(1)}%`}
        />
        <Kpi
          label="Mesas ocupadas"
          value={`${metrics.occupied_tables}/${metrics.total_tables}`}
          hint={`${metrics.open_orders} órdenes abiertas · ${money(metrics.open_orders_value)}`}
        />
        <Kpi label="Ítems vendidos" value={String(metrics.items_sold)} />
        <Kpi label="Mermas" value={money(metrics.waste_cost)} hint="Costo de desperdicio registrado" />
        <Kpi
          label="Descuentos y cortesías"
          value={money(metrics.discounts + metrics.comps)}
          hint={`Desc. ${money(metrics.discounts)} · Cort. ${money(metrics.comps)}`}
        />
        <Kpi
          label="Impuestos recaudados"
          value={money(metrics.tax_collected)}
          hint={metrics.voided_payments > 0 ? `${metrics.voided_payments} pago(s) anulado(s)` : 'Incluidos en las ventas'}
        />
        <Kpi
          label="Preparación cocina"
          value={metrics.avg_prep_minutes.kitchen != null ? `${metrics.avg_prep_minutes.kitchen} min` : '—'}
          hint="Promedio hasta 'listo'"
        />
        <Kpi
          label="Preparación barra"
          value={metrics.avg_prep_minutes.bar != null ? `${metrics.avg_prep_minutes.bar} min` : '—'}
          hint="Promedio hasta 'listo'"
        />
      </section>

      <section className="grid gap-4 lg:grid-cols-5">
        {/* Top productos: barras horizontales de una sola serie */}
        <Card className="lg:col-span-3">
          <h2 className="mb-4 font-semibold">Productos más vendidos</h2>
          {metrics.top_products.length === 0 ? (
            <p className="py-8 text-center text-sm text-zinc-500">Aún no hay ventas en este periodo.</p>
          ) : (
            <ol className="space-y-2.5">
              {metrics.top_products.map((p) => (
                <li
                  key={p.product_id}
                  className="group grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-3 text-sm"
                  title={`${p.product_name}: ${p.quantity} u · ${money(p.revenue)}`}
                >
                  <span className="truncate text-zinc-700 dark:text-zinc-300">
                    {p.station === 'bar' ? '🍸' : '🍽️'} {p.product_name}
                  </span>
                  <span className="h-3 rounded-r bg-zinc-100 dark:bg-zinc-800">
                    <span
                      className="block h-full rounded-r bg-brand-500 transition-[width] group-hover:bg-brand-600"
                      style={{ width: `${(p.quantity / maxQty) * 100}%` }}
                    />
                  </span>
                  <span className="tabular w-28 text-right text-zinc-600 dark:text-zinc-400">
                    <b className="text-zinc-900 dark:text-zinc-100">{p.quantity}</b> · {money(p.revenue)}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </Card>

        <div className="space-y-4 lg:col-span-2">
          <Card>
            <h2 className="mb-3 font-semibold">Medios de pago</h2>
            <dl className="space-y-2 text-sm">
              {(Object.keys(METHOD_LABELS) as PaymentMethod[])
                .filter((m) => (metrics.payments_by_method[m] ?? 0) > 0)
                .map((m) => {
                  const value = metrics.payments_by_method[m] ?? 0;
                  return (
                    <div key={m} className="flex items-center justify-between">
                      <dt className="text-zinc-600 dark:text-zinc-400">{METHOD_LABELS[m]}</dt>
                      <dd className="tabular font-semibold">
                        {money(value)}{' '}
                        <span className="font-normal text-zinc-500">({((value / methodTotal) * 100).toFixed(0)}%)</span>
                      </dd>
                    </div>
                  );
                })}
              {methodTotal === 0 && <p className="text-zinc-500">Sin pagos todavía.</p>}
            </dl>
            <h2 className="mb-2 mt-5 font-semibold">Ventas por estación</h2>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-zinc-600 dark:text-zinc-400">🍽️ Cocina</dt>
                <dd className="tabular font-semibold">{money(metrics.sales_by_station.kitchen ?? 0)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-zinc-600 dark:text-zinc-400">🍸 Barra</dt>
                <dd className="tabular font-semibold">{money(metrics.sales_by_station.bar ?? 0)}</dd>
              </div>
            </dl>
          </Card>

          <Card>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-semibold">Stock bajo</h2>
              <Link href="/admin/inventory" className="text-sm font-semibold text-brand-600 hover:underline">
                Inventario →
              </Link>
            </div>
            {lowStock.length === 0 ? (
              <p className="text-sm text-zinc-500">Todo el inventario está sobre el mínimo.</p>
            ) : (
              <ul className="space-y-1.5 text-sm">
                {lowStock.slice(0, 8).map((i) => (
                  <li key={i.id} className="flex items-center gap-2">
                    <AlertTriangle className="size-4 shrink-0 text-red-600" aria-label="Stock bajo" />
                    <span className="flex-1 truncate">{i.name}</span>
                    <span className="tabular text-zinc-500">
                      {formatQuantity(i.stock, i.unit)} / mín {formatQuantity(i.min, i.unit)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </section>

      {/* Ventas por hora: columnas de una serie, valor en tooltip y tabla accesible */}
      <Card>
        <h2 className="mb-4 font-semibold">Ventas por hora</h2>
        {metrics.hourly_revenue.length === 0 ? (
          <p className="py-6 text-center text-sm text-zinc-500">Sin pagos en este periodo.</p>
        ) : (
          <>
            <div className="flex h-40 items-end gap-1 border-b border-zinc-200 dark:border-zinc-800" aria-hidden>
              {metrics.hourly_revenue.map((h) => (
                <div key={h.hour} className="group relative flex h-full flex-1 items-end">
                  <div
                    className="w-full rounded-t bg-brand-500 group-hover:bg-brand-600"
                    style={{ height: `${Math.max(2, (h.revenue / maxHour) * 100)}%` }}
                  />
                  <span className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded-lg bg-zinc-900 px-2 py-1 text-xs text-white group-hover:block dark:bg-zinc-100 dark:text-zinc-900">
                    {hourFmt.format(new Date(h.hour))} · {money(h.revenue)}
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-1 flex justify-between text-xs text-zinc-500" aria-hidden>
              <span>{hourFmt.format(new Date(metrics.hourly_revenue[0]!.hour))}</span>
              <span>{hourFmt.format(new Date(metrics.hourly_revenue.at(-1)!.hour))}</span>
            </div>
            <details className="mt-3 text-sm">
              <summary className="cursor-pointer text-zinc-500">Ver tabla</summary>
              <table className="mt-2 w-full text-left">
                <thead>
                  <tr className="text-zinc-500">
                    <th className="py-1 font-medium">Hora</th>
                    <th className="py-1 text-right font-medium">Ventas</th>
                  </tr>
                </thead>
                <tbody className="tabular">
                  {metrics.hourly_revenue.map((h) => (
                    <tr key={h.hour} className="border-t border-zinc-100 dark:border-zinc-800">
                      <td className="py-1">{hourFmt.format(new Date(h.hour))}</td>
                      <td className="py-1 text-right">{money(h.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          </>
        )}
      </Card>
    </div>
  );
}

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card className="p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">{label}</p>
      <p className="tabular mt-1 text-2xl font-bold">{value}</p>
      {hint && <p className="mt-0.5 truncate text-xs text-zinc-500">{hint}</p>}
    </Card>
  );
}
