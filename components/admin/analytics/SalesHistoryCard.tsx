import { ArrowDownRight, ArrowUpRight, History } from 'lucide-react';
import { Card } from '@/components/ui/primitives';
import type { MonthSales } from '@/lib/analytics/sales-history';
import { cn, formatCurrency } from '@/lib/utils';

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const label = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(2, 4)}`;
const SOURCE: Record<string, string> = { sigec: 'SIGEC' };

function Change({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="text-zinc-400">—</span>;
  const up = pct > 0;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={cn('inline-flex items-center gap-0.5 font-semibold tabular-nums', pct === 0 ? 'text-zinc-500' : up ? 'text-emerald-600' : 'text-red-600')}>
      {pct !== 0 && <Icon className="size-3.5" aria-hidden />}
      {up ? '+' : ''}
      {pct}%
    </span>
  );
}

/** Ventas por mes con el historial importado y comparación contra el mismo mes del año anterior. */
export function SalesHistoryCard({
  months,
  historyUntil,
  historySource,
  rangeLabel,
  rangeCompare,
  currency,
  locale,
}: {
  months: MonthSales[];
  historyUntil: string | null;
  historySource: string | null;
  rangeLabel: string;
  rangeCompare: { current: { revenue: number; orders: number }; previous: { revenue: number; orders: number }; change_pct: number | null };
  currency: string;
  locale: string;
}) {
  const money = (n: number) => formatCurrency(n, currency, locale);
  const shown = months.slice(-18);
  const max = Math.max(1, ...shown.map((m) => m.revenue));
  const table = months.filter((m) => !m.partial).slice(-6).reverse();
  const current = months.find((m) => m.partial);
  const untilText = historyUntil
    ? new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${historyUntil}T00:00:00Z`))
    : null;

  return (
    <Card className="space-y-5">
      <div className="flex flex-wrap items-start gap-3">
        <History className="mt-0.5 size-5 shrink-0 text-zinc-500" aria-hidden />
        <div className="mr-auto min-w-0">
          <h2 className="font-semibold">Ventas por mes</h2>
          <p className="text-sm text-zinc-500">
            {untilText
              ? `Incluye el historial importado${historySource && SOURCE[historySource] ? ` de ${SOURCE[historySource]}` : ''} hasta el ${untilText}; desde ahí, las ventas de GastroBar.`
              : 'Ventas cerradas en GastroBar.'}
          </p>
        </div>
        <div className="rounded-xl bg-zinc-50 px-4 py-2 text-sm dark:bg-zinc-900">
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">{rangeLabel} vs. año pasado</p>
          <p className="flex flex-wrap items-baseline gap-2">
            <span className="text-lg font-bold tabular-nums">{money(rangeCompare.current.revenue)}</span>
            <Change pct={rangeCompare.change_pct} />
          </p>
          <p className="text-xs text-zinc-500">Mismos días del año pasado: {rangeCompare.previous.revenue ? money(rangeCompare.previous.revenue) : 'sin datos'}</p>
        </div>
      </div>

      {shown.length === 0 ? (
        <p className="py-6 text-center text-sm text-zinc-500">Todavía no hay ventas para mostrar.</p>
      ) : (
        <div>
          <div className="flex h-44 items-end gap-1" role="img" aria-label="Ventas por mes">
            {shown.map((m) => (
              <div
                key={m.month}
                title={`${label(m.month)}${m.partial ? ' (en curso)' : ''}: ${money(m.revenue)} · ${m.orders} cuentas${m.change_pct === null ? '' : ` · ${m.change_pct > 0 ? '+' : ''}${m.change_pct}% vs. año pasado`}`}
                className={cn(
                  'min-w-0 flex-1 rounded-t',
                  m.partial ? 'border border-dashed border-brand-500 bg-brand-500/25' : 'bg-brand-500 hover:bg-brand-600',
                )}
                style={{ height: `${Math.max(1, (m.revenue / max) * 100)}%` }}
              />
            ))}
          </div>
          <div className="mt-2 flex justify-between text-xs text-zinc-500">
            <span>{label(shown[0]!.month)}</span>
            {current && <span>{label(current.month)}: en curso</span>}
            <span>{label(shown.at(-1)!.month)}</span>
          </div>
        </div>
      )}

      {table.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-zinc-500">
                <th className="py-2 pr-3 font-medium">Mes</th>
                <th className="py-2 pr-3 text-right font-medium">Ventas</th>
                <th className="py-2 pr-3 text-right font-medium">Año pasado</th>
                <th className="py-2 pr-3 text-right font-medium">Cambio</th>
                <th className="py-2 text-right font-medium">Ticket</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {table.map((m) => (
                <tr key={m.month}>
                  <td className="py-2 pr-3 font-medium capitalize">{label(m.month)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{money(m.revenue)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums text-zinc-500">{m.previous_year ? money(m.previous_year.revenue) : '—'}</td>
                  <td className="py-2 pr-3 text-right"><Change pct={m.change_pct} /></td>
                  <td className="py-2 text-right tabular-nums">{m.orders ? money(m.revenue / m.orders) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
