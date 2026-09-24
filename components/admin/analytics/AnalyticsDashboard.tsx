import { AlertOctagon, AlertTriangle, ArrowDownRight, ArrowUpRight, Info } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Badge, Card } from '@/components/ui/primitives';
import { MENU_CLASS_LABEL, WEEKDAYS } from '@/lib/analytics/analyze';
import type { Anomaly, BusinessAnalysis, KpiChange, MenuClass } from '@/lib/analytics/types';
import { cn, formatCurrency } from '@/lib/utils';

const UNIT: Record<'g' | 'ml' | 'unit', string> = { g: 'g', ml: 'ml', unit: 'u' };
const METHOD: Record<string, string> = { cash: 'Efectivo', card: 'Tarjeta', transfer: 'Transferencia', other: 'Otro' };
const CHANNEL: Record<string, string> = { pos: 'Meseros (POS)', qr: 'Menú QR', ai_agent: 'Agente IA' };

const CLASS_STYLE: Record<MenuClass, string> = {
  star: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200',
  plowhorse: 'bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-200',
  puzzle: 'bg-violet-100 text-violet-800 dark:bg-violet-500/15 dark:text-violet-200',
  dog: 'bg-zinc-200 text-zinc-700 dark:bg-zinc-700/60 dark:text-zinc-200',
};
const CLASS_HINT: Record<MenuClass, string> = {
  star: 'Se vende mucho y deja buen margen: protégelo y destácalo.',
  plowhorse: 'Se vende mucho pero deja poco: revisa porción, costo o sube el precio.',
  puzzle: 'Deja buen margen pero se vende poco: promociónalo o recolócalo en la carta.',
  dog: 'Se vende poco y deja poco: candidato a salir del menú.',
};

const SEVERITY: Record<Anomaly['severity'], { icon: typeof Info; className: string; label: string }> = {
  critical: { icon: AlertOctagon, className: 'text-red-600', label: 'Crítico' },
  warning: { icon: AlertTriangle, className: 'text-amber-600', label: 'Atención' },
  info: { icon: Info, className: 'text-sky-600', label: 'Info' },
};

function Delta({ change, goodWhenUp = true }: { change: KpiChange; goodWhenUp?: boolean }) {
  if (change.change_pct === null || change.change_pct === 0) {
    return <span className="text-xs text-zinc-400">{change.previous === 0 && change.current > 0 ? 'Sin periodo previo' : 'Sin cambio'}</span>;
  }
  const up = change.change_pct > 0;
  const good = up === goodWhenUp;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={cn('inline-flex items-center gap-0.5 text-xs font-semibold', good ? 'text-emerald-600' : 'text-red-600')}>
      <Icon className="size-3.5" aria-hidden />
      {up ? '+' : ''}
      {change.change_pct}% vs. anterior
    </span>
  );
}

function Kpi({ label, value, footer }: { label: string; value: string; footer?: ReactNode }) {
  return (
    <Card className="space-y-1">
      <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">{label}</p>
      <p className="text-2xl font-bold tabular-nums">{value}</p>
      {footer && <div className="min-h-4">{footer}</div>}
    </Card>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-sm text-zinc-500">{children}</p>;
}

export function AnalyticsDashboard({
  analysis,
  locale,
  range,
  ranges,
  analyst,
  locked = {},
}: {
  analysis: BusinessAnalysis;
  locale: string;
  range: string;
  ranges: Array<{ key: string; label: string }>;
  /** Panel del Agente Analista (se renderiza entre el encabezado y los indicadores). */
  analyst?: ReactNode;
  /** Secciones de agentes no contratados: se reemplazan por su invitación. */
  locked?: { alerts?: ReactNode; menu?: ReactNode };
}) {
  const { snapshot: s, changes: c, ratios, menu } = analysis;
  const money = (n: number) => formatCurrency(n, s.period.currency, locale);
  const num = (n: number, d = 0) => new Intl.NumberFormat(locale, { maximumFractionDigits: d }).format(n);
  const grossMargin = s.kpis.net_revenue - s.kpis.ingredient_cost;
  const prevGrossMargin = s.previous_kpis.net_revenue - s.previous_kpis.ingredient_cost;
  const marginChange: KpiChange = {
    current: grossMargin,
    previous: prevGrossMargin,
    change_pct: prevGrossMargin !== 0 ? Math.round(((grossMargin - prevGrossMargin) / Math.abs(prevGrossMargin)) * 1000) / 10 : null,
  };

  const maxDaily = Math.max(1, ...s.daily.map((d) => Number(d.revenue)));
  const maxWeekday = Math.max(1, ...analysis.weekdays.map((w) => w.avg_revenue));
  const hours = s.heatmap.map((h) => h.hour);
  const hourRange = hours.length ? Array.from({ length: Math.max(...hours) - Math.min(...hours) + 1 }, (_, i) => Math.min(...hours) + i) : [];
  const heat = new Map(s.heatmap.map((h) => [`${h.dow}-${h.hour}`, h]));
  const maxHeat = Math.max(1, ...s.heatmap.map((h) => Number(h.revenue)));
  const methodTotal = Object.values(s.payments).reduce((a, b) => a + Number(b ?? 0), 0);
  const quadrants = (['star', 'plowhorse', 'puzzle', 'dog'] as const).map((cls) => ({
    cls,
    items: menu.products.filter((p) => p.class === cls),
  }));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <h1 className="text-2xl font-bold">Análisis del negocio</h1>
          <p className="text-sm text-zinc-500">
            {s.period.days} días comparados con los {s.period.days} anteriores · cifras calculadas de tus ventas reales
          </p>
        </div>
        <nav aria-label="Periodo" className="flex gap-1 rounded-xl bg-zinc-100 p-1 dark:bg-zinc-900">
          {ranges.map((r) => (
            <Link
              key={r.key}
              href={`/admin/analytics?range=${r.key}`}
              aria-current={range === r.key ? 'page' : undefined}
              className={cn('rounded-lg px-3 py-1.5 text-sm font-semibold', range === r.key ? 'bg-white shadow dark:bg-zinc-800' : 'text-zinc-500')}
            >
              {r.label}
            </Link>
          ))}
        </nav>
      </div>

      {analyst}

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Ventas" value={money(s.kpis.revenue)} footer={<Delta change={c.revenue} />} />
        <Kpi label="Cuentas" value={num(s.kpis.orders)} footer={<Delta change={c.orders} />} />
        <Kpi label="Ticket promedio" value={money(s.kpis.avg_ticket)} footer={<Delta change={c.avg_ticket} />} />
        <Kpi
          label="Venta por persona"
          value={ratios.revenue_per_guest === null ? '—' : money(ratios.revenue_per_guest)}
          footer={<span className="text-xs text-zinc-500">{num(s.kpis.guests)} personas atendidas</span>}
        />
        <Kpi
          label="Margen bruto"
          value={money(grossMargin)}
          footer={<Delta change={marginChange} />}
        />
        <Kpi
          label="Food cost"
          value={ratios.food_cost_pct === null ? '—' : `${ratios.food_cost_pct}%`}
          footer={
            <span className="text-xs text-zinc-500">
              {ratios.prev_food_cost_pct === null ? 'Referencia sana: 28–35%' : `Antes: ${ratios.prev_food_cost_pct}%`}
            </span>
          }
        />
        <Kpi
          label="Descuentos y cortesías"
          value={money(s.kpis.discounts + s.kpis.comps)}
          footer={
            <span className="text-xs text-zinc-500">
              {ratios.discount_pct ?? 0}% desc. · {ratios.comp_pct ?? 0}% cort.
            </span>
          }
        />
        <Kpi
          label="Mermas y faltantes"
          value={money(s.kpis.waste_cost + s.kpis.shrinkage_cost)}
          footer={<span className="text-xs text-zinc-500">Mermas {money(s.kpis.waste_cost)} · ajustes {money(s.kpis.shrinkage_cost)}</span>}
        />
      </section>

      {locked.alerts ?? (
      <Card>
        <div className="mb-3 flex items-center gap-2">
          <h2 className="mr-auto font-semibold">Alertas</h2>
          <Badge className="bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">{analysis.anomalies.length}</Badge>
        </div>
        {analysis.anomalies.length === 0 ? (
          <Empty>No se detectó nada fuera de lo normal en este periodo.</Empty>
        ) : (
          <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {analysis.anomalies.map((a) => {
              const sev = SEVERITY[a.severity];
              const Icon = sev.icon;
              return (
                <li key={a.id} className="flex gap-3 py-3">
                  <Icon className={cn('mt-0.5 size-5 shrink-0', sev.className)} aria-label={sev.label} />
                  <div className="min-w-0">
                    <p className="font-semibold">{a.title}</p>
                    <p className="text-sm text-zinc-600 dark:text-zinc-400">{a.detail}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      )}

      <section className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <h2 className="mb-4 font-semibold">Ventas por día</h2>
          {s.kpis.orders === 0 ? (
            <Empty>Aún no hay ventas cerradas en este periodo.</Empty>
          ) : (
            <>
              <div className="flex h-40 items-end gap-[3px]" role="img" aria-label="Ventas diarias del periodo">
                {s.daily.map((d) => (
                  <div
                    key={d.date}
                    title={`${d.date}: ${money(Number(d.revenue))} · ${d.orders} cuentas`}
                    className="min-w-0 flex-1 rounded-t bg-brand-500 hover:bg-brand-600"
                    style={{ height: `${Math.max(1, (Number(d.revenue) / maxDaily) * 100)}%` }}
                  />
                ))}
              </div>
              <div className="mt-2 flex justify-between text-xs text-zinc-500">
                <span>{s.daily[0]?.date}</span>
                <span>Promedio diario {money(ratios.avg_daily_revenue)}</span>
                <span>{s.daily.at(-1)?.date}</span>
              </div>
            </>
          )}
        </Card>

        <Card className="lg:col-span-2">
          <h2 className="mb-4 font-semibold">Promedio por día de la semana</h2>
          <ul className="space-y-2">
            {analysis.weekdays.map((w) => (
              <li key={w.dow} className="grid grid-cols-[5.5rem_1fr_auto] items-center gap-3 text-sm">
                <span>{w.label}</span>
                <div className="h-2.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                  <div className="h-full rounded-full bg-brand-500" style={{ width: `${(w.avg_revenue / maxWeekday) * 100}%` }} />
                </div>
                <span className="tabular-nums text-zinc-600 dark:text-zinc-400">{money(w.avg_revenue)}</span>
              </li>
            ))}
          </ul>
        </Card>
      </section>

      <Card>
        <div className="mb-4 flex flex-wrap items-baseline gap-2">
          <h2 className="mr-auto font-semibold">Horas pico</h2>
          {analysis.peak_hours.length > 0 && (
            <p className="text-sm text-zinc-500">Más fuerte: {analysis.peak_hours.slice(0, 3).map((h) => h.label).join(' · ')}</p>
          )}
        </div>
        {hourRange.length === 0 ? (
          <Empty>Sin datos de horario todavía.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="border-separate border-spacing-[3px] text-xs">
              <thead>
                <tr>
                  <th />
                  {hourRange.map((h) => (
                    <th key={h} className="px-0.5 font-normal text-zinc-500">
                      {String(h).padStart(2, '0')}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[1, 2, 3, 4, 5, 6, 7].map((dow) => (
                  <tr key={dow}>
                    <th className="pr-2 text-left font-medium text-zinc-500">{WEEKDAYS[dow]?.slice(0, 3)}</th>
                    {hourRange.map((h) => {
                      const cell = heat.get(`${dow}-${h}`);
                      const intensity = cell ? Number(cell.revenue) / maxHeat : 0;
                      return (
                        <td
                          key={h}
                          title={cell ? `${WEEKDAYS[dow]} ${h}:00 · ${money(Number(cell.revenue))} · ${cell.orders} cuentas` : undefined}
                          className="size-7 min-w-7 rounded bg-zinc-100 dark:bg-zinc-800"
                          style={cell ? { backgroundColor: `color-mix(in oklch, var(--color-brand-600) ${Math.round(15 + intensity * 85)}%, transparent)` } : undefined}
                        />
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {locked.menu ?? (
      <Card>
        <h2 className="mb-1 font-semibold">Ingeniería de menú</h2>
        <p className="mb-4 text-sm text-zinc-500">
          Cada producto según su popularidad (participación en unidades vendidas) y su margen por unidad frente al promedio de{' '}
          {money(menu.avg_unit_margin)}.
        </p>
        {menu.products.length === 0 ? (
          <Empty>Aún no hay productos vendidos en este periodo.</Empty>
        ) : (
          <>
            <div className="mb-5 grid gap-3 sm:grid-cols-2">
              {quadrants.map(({ cls, items }) => (
                <div key={cls} className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
                  <div className="mb-1 flex items-center gap-2">
                    <Badge className={CLASS_STYLE[cls]}>{MENU_CLASS_LABEL[cls]}</Badge>
                    <span className="text-xs text-zinc-500">{items.length} producto(s)</span>
                  </div>
                  <p className="mb-2 text-xs text-zinc-500">{CLASS_HINT[cls]}</p>
                  <p className="text-sm">{items.length ? items.map((p) => p.name).join(', ') : '—'}</p>
                </div>
              ))}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm tabular-nums">
                <thead className="text-left text-xs uppercase tracking-wide text-zinc-500">
                  <tr className="border-b border-zinc-200 dark:border-zinc-800">
                    <th className="py-2 pr-3 font-semibold">Producto</th>
                    <th className="py-2 pr-3 font-semibold">Tipo</th>
                    <th className="py-2 pr-3 text-right font-semibold">Vendidos</th>
                    <th className="py-2 pr-3 text-right font-semibold">Mix</th>
                    <th className="py-2 pr-3 text-right font-semibold">Venta</th>
                    <th className="py-2 pr-3 text-right font-semibold">Margen u.</th>
                    <th className="py-2 text-right font-semibold">Food cost</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {menu.products.map((p) => (
                    <tr key={p.product_id}>
                      <td className="py-2 pr-3">
                        <span className="font-medium">{p.name}</span>
                        {p.comped_quantity > 0 && <span className="ml-1 text-xs text-zinc-500">+{p.comped_quantity} cortesía</span>}
                      </td>
                      <td className="py-2 pr-3">
                        <Badge className={CLASS_STYLE[p.class]}>{MENU_CLASS_LABEL[p.class]}</Badge>
                      </td>
                      <td className="py-2 pr-3 text-right">{num(p.quantity)}</td>
                      <td className="py-2 pr-3 text-right">{p.mix_pct}%</td>
                      <td className="py-2 pr-3 text-right">{money(p.revenue)}</td>
                      <td className="py-2 pr-3 text-right">{money(p.unit_margin)}</td>
                      <td
                        className={cn(
                          'py-2 text-right',
                          p.food_cost_pct !== null && p.food_cost_pct > 40 && 'font-semibold text-red-600',
                        )}
                      >
                        {p.food_cost_pct === null ? 'Sin receta' : `${p.food_cost_pct}%`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {s.unsold_products.length > 0 && (
              <p className="mt-4 text-sm text-zinc-500">
                <b className="text-zinc-700 dark:text-zinc-300">Sin ventas en el periodo:</b> {s.unsold_products.map((p) => p.name).join(', ')}
              </p>
            )}
          </>
        )}
      </Card>
      )}

      <section className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="mb-4 font-semibold">Equipo</h2>
          {s.staff.length === 0 ? (
            <Empty>Sin cuentas cerradas en el periodo.</Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm tabular-nums">
                <thead className="text-left text-xs uppercase tracking-wide text-zinc-500">
                  <tr className="border-b border-zinc-200 dark:border-zinc-800">
                    <th className="py-2 pr-3 font-semibold">Persona</th>
                    <th className="py-2 pr-3 text-right font-semibold">Cuentas</th>
                    <th className="py-2 pr-3 text-right font-semibold">Ventas</th>
                    <th className="py-2 pr-3 text-right font-semibold">Ticket</th>
                    <th className="py-2 pr-3 text-right font-semibold">Desc.+cort.</th>
                    <th className="py-2 text-right font-semibold">Anulados</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {s.staff.map((w) => (
                    <tr key={w.profile_id ?? 'none'}>
                      <td className="py-2 pr-3 font-medium">{w.name}</td>
                      <td className="py-2 pr-3 text-right">{num(w.orders)}</td>
                      <td className="py-2 pr-3 text-right">{money(Number(w.revenue))}</td>
                      <td className="py-2 pr-3 text-right">{money(Number(w.avg_ticket))}</td>
                      <td className="py-2 pr-3 text-right">{money(Number(w.discounts) + Number(w.comps))}</td>
                      <td className={cn('py-2 text-right', w.voided_payments > 0 && 'font-semibold text-amber-600')}>{w.voided_payments}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card className="space-y-5">
          <div>
            <h2 className="mb-3 font-semibold">Tiempos de preparación</h2>
            {s.stations.length === 0 ? (
              <Empty>Sin comandas marcadas como listas.</Empty>
            ) : (
              <ul className="space-y-2 text-sm">
                {s.stations.map((st) => (
                  <li key={st.station} className="flex flex-wrap items-baseline gap-x-3">
                    <span className="w-16 font-medium">{st.station === 'bar' ? 'Barra' : 'Cocina'}</span>
                    <span className="tabular-nums">
                      {st.avg_minutes} min prom. · 90% en ≤ {st.p90_minutes} min
                    </span>
                    <span className={cn('ml-auto tabular-nums', st.pct_late >= 15 ? 'font-semibold text-red-600' : 'text-zinc-500')}>
                      {st.pct_late}% en rojo
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {s.table_minutes !== null && (
              <p className="mt-2 text-sm text-zinc-500">Una mesa dura en promedio {num(Number(s.table_minutes))} min abierta.</p>
            )}
          </div>
          <div>
            <h2 className="mb-3 font-semibold">Medios de pago</h2>
            {methodTotal === 0 ? (
              <Empty>Sin pagos.</Empty>
            ) : (
              <ul className="space-y-1.5 text-sm">
                {Object.entries(s.payments).map(([m, v]) => (
                  <li key={m} className="flex justify-between tabular-nums">
                    <span>{METHOD[m] ?? m}</span>
                    <span>
                      {money(Number(v))} · {Math.round((Number(v) / methodTotal) * 100)}%
                    </span>
                  </li>
                ))}
                <li className="flex justify-between text-zinc-500 tabular-nums">
                  <span>Propinas</span>
                  <span>{money(s.kpis.tips)}</span>
                </li>
              </ul>
            )}
            {Object.keys(s.channels).length > 1 && (
              <p className="mt-2 text-sm text-zinc-500">
                {Object.entries(s.channels)
                  .map(([ch, v]) => `${CHANNEL[ch] ?? ch}: ${v?.orders ?? 0} cuentas`)
                  .join(' · ')}
              </p>
            )}
          </div>
        </Card>
      </section>

      <section className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <h2 className="mb-1 font-semibold">Consumo de insumos</h2>
          <p className="mb-4 text-sm text-zinc-500">Lo que salió del inventario en el periodo, por causa.</p>
          {s.inventory.usage.length === 0 ? (
            <Empty>Sin movimientos de inventario en el periodo.</Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm tabular-nums">
                <thead className="text-left text-xs uppercase tracking-wide text-zinc-500">
                  <tr className="border-b border-zinc-200 dark:border-zinc-800">
                    <th className="py-2 pr-3 font-semibold">Insumo</th>
                    <th className="py-2 pr-3 text-right font-semibold">Ventas</th>
                    <th className="py-2 pr-3 text-right font-semibold">Mermas</th>
                    <th className="py-2 pr-3 text-right font-semibold">Faltantes</th>
                    <th className="py-2 text-right font-semibold">Costo</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {s.inventory.usage.slice(0, 15).map((u) => (
                    <tr key={u.ingredient_id}>
                      <td className="py-2 pr-3 font-medium">{u.name}</td>
                      <td className="py-2 pr-3 text-right">
                        {num(Number(u.sold), 1)} {UNIT[u.unit]}
                      </td>
                      <td className="py-2 pr-3 text-right">{Number(u.waste) > 0 ? `${num(Number(u.waste), 1)} ${UNIT[u.unit]}` : '—'}</td>
                      <td className={cn('py-2 pr-3 text-right', Number(u.shrinkage) > 0 && 'font-semibold text-amber-600')}>
                        {Number(u.shrinkage) > 0 ? `${num(Number(u.shrinkage), 1)} ${UNIT[u.unit]}` : '—'}
                      </td>
                      <td className="py-2 text-right">{money(Number(u.cost))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card className="space-y-5 lg:col-span-2">
          <div>
            <h2 className="mb-1 font-semibold">Inventario hoy</h2>
            <p className="text-sm text-zinc-500">Valor en bodega: {money(Number(s.inventory.stock_value))}</p>
            {s.inventory.low_stock.length > 0 ? (
              <ul className="mt-3 space-y-1 text-sm">
                {s.inventory.low_stock.map((i) => (
                  <li key={i.name} className="flex justify-between gap-3">
                    <span>{i.name}</span>
                    <span className="tabular-nums text-amber-600">
                      {num(Number(i.stock), 1)} / mín. {num(Number(i.min), 1)} {UNIT[i.unit]}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-sm text-emerald-600">Ningún insumo bajo el mínimo.</p>
            )}
          </div>
          <div>
            <h2 className="mb-1 font-semibold">Cierres de caja</h2>
            <p className="text-sm text-zinc-500">
              {s.cash.sessions} cierre(s) en el periodo · diferencia neta {money(Number(s.cash.total_difference))}
            </p>
            {s.cash.differences.length > 0 && (
              <ul className="mt-2 space-y-1 text-sm">
                {s.cash.differences.map((d, i) => (
                  <li key={i} className="flex justify-between gap-3">
                    <span>{d.closed_by ?? 'Sin nombre'}</span>
                    <span className={cn('tabular-nums', Number(d.difference) < 0 ? 'text-red-600' : 'text-amber-600')}>
                      {money(Number(d.difference))}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      </section>
    </div>
  );
}
