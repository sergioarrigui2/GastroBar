import { Download, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { Badge, Button, Card, Label, Select } from '@/components/ui/primitives';
import { actorLabel, CATEGORY_LABEL, describeAudit, SENSITIVE_COLUMNS, SEVERITY_LABEL } from '@/lib/audit/describe';
import { PERMISSION_INFO } from '@/lib/permissions';
import { AUDIT_RANGES, AUDIT_SEVERITY_FILTERS, type AuditFilters, type AuditRow, type getAuditLog } from '@/lib/services/audit';
import { cn, formatCurrency } from '@/lib/utils';
import type { AuditSeverity } from '@/types/database';

type Data = Awaited<ReturnType<typeof getAuditLog>>;

const SEVERITY_STYLE: Record<AuditSeverity, string> = {
  critical: 'bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-200',
  important: 'bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-200',
  info: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300',
};
const DOT: Record<AuditSeverity, string> = { critical: 'bg-red-500', important: 'bg-amber-500', info: 'bg-zinc-300 dark:bg-zinc-600' };

const DETAIL_LABEL: Record<string, string> = {
  order_number: 'Cuenta', table: 'Mesa', reason: 'Motivo', amount: 'Valor', total: 'Total', paid: 'Cobrado', product: 'Producto', quantity: 'Cantidad',
  method: 'Medio de pago', tip: 'Propina', from: 'Antes', to: 'Después', name: 'Nombre', ingredient: 'Insumo', unit: 'Unidad', value: 'Valor', stock_after: 'Stock final',
  opening_float: 'Base de caja', counted_cash: 'Contado', expected_cash: 'Esperado', difference: 'Diferencia', notes: 'Notas', status_before: 'Estado anterior',
  discount_total: 'Descuento', subtotal: 'Subtotal', type: 'Tipo', round: 'Ronda', items: 'Productos', changes: 'Cambios', role: 'Rol',
};
const MONEY_KEYS = new Set(['amount', 'total', 'paid', 'tip', 'value', 'opening_float', 'counted_cash', 'expected_cash', 'difference', 'discount_total', 'subtotal']);

function qs(f: AuditFilters, over: Partial<Record<'rango' | 'gravedad' | 'categoria' | 'persona' | 'pagina', string | undefined>> = {}) {
  const p = new URLSearchParams();
  const base = { rango: f.range, gravedad: f.severity, categoria: f.category, persona: f.actor, pagina: f.page > 1 ? String(f.page) : undefined, ...over };
  for (const [k, v] of Object.entries(base)) if (v) p.set(k, v);
  return p.toString();
}

export function AuditView({ data, filters, currency, locale, timezone }: { data: Data; filters: AuditFilters; currency: string; locale: string; timezone: string }) {
  const money = (n: number) => formatCurrency(n, currency, locale);
  const day = (iso: string) => new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long', timeZone: timezone }).format(new Date(iso));
  const time = (iso: string) => new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', timeZone: timezone }).format(new Date(iso));
  const permissionLabels = Object.fromEntries(Object.entries(PERMISSION_INFO).map(([k, v]) => [k, v.label]));
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));

  const groups: Array<{ key: string; label: string; rows: AuditRow[] }> = [];
  for (const r of data.rows) {
    const key = new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date(r.at));
    const last = groups.at(-1);
    if (last?.key === key) last.rows.push(r);
    else groups.push({ key, label: day(r.at), rows: [r] });
  }

  const detailValue = (k: string, v: unknown) => {
    if (typeof v === 'number' && MONEY_KEYS.has(k)) return money(v);
    if (Array.isArray(v) && k === 'items') return v.map((i: { name?: string; qty?: number }) => `${i.qty}× ${i.name}`).join(', ');
    if (v !== null && typeof v === 'object') return JSON.stringify(v);
    return String(v);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start gap-3">
        <div className="mr-auto">
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <ShieldCheck className="size-6 text-brand-600" aria-hidden /> Auditoría
          </h1>
          <p className="max-w-2xl text-sm text-zinc-500">
            Quién hizo qué y cuándo, en lo que afecta el dinero, el inventario, el menú, las personas y los ajustes. Lo registra el sistema solo: nadie puede
            editarlo ni borrarlo, ni siquiera un administrador.
          </p>
        </div>
        <Link
          href={`/admin/audit/export?${qs(filters, { pagina: undefined })}`}
          className="inline-flex h-10 items-center gap-2 rounded-xl bg-zinc-100 px-4 text-sm font-semibold hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700"
        >
          <Download className="size-4" aria-hidden /> Exportar a Excel (CSV)
        </Link>
      </div>

      <Card>
        <form method="get" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5 lg:items-end">
          <div>
            <Label htmlFor="rango">Periodo</Label>
            <Select id="rango" name="rango" defaultValue={filters.range}>
              {Object.entries(AUDIT_RANGES).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.label}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="gravedad">Qué mostrar</Label>
            <Select id="gravedad" name="gravedad" defaultValue={filters.severity}>
              {Object.entries(AUDIT_SEVERITY_FILTERS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="categoria">Tema</Label>
            <Select id="categoria" name="categoria" defaultValue={filters.category ?? ''}>
              <option value="">Todos</option>
              {Object.entries(CATEGORY_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="persona">Persona</Label>
            <Select id="persona" name="persona" defaultValue={filters.actor ?? ''}>
              <option value="">Todas</option>
              <option value="sistema">El sistema</option>
              {data.people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name}
                </option>
              ))}
            </Select>
          </div>
          <Button type="submit">Filtrar</Button>
        </form>
      </Card>

      <section className="grid grid-cols-3 gap-3">
        <Card className="space-y-1">
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Críticos</p>
          <p className={cn('tabular text-3xl font-bold', data.severity.critical > 0 && 'text-red-600')}>{data.severity.critical}</p>
          <p className="text-xs text-zinc-500">Anulaciones, diferencias de caja, ajustes grandes, cambios de permisos</p>
        </Card>
        <Card className="space-y-1">
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Importantes</p>
          <p className="tabular text-3xl font-bold">{data.severity.important}</p>
          <p className="text-xs text-zinc-500">Descuentos, cortesías, mermas, precios, recetas, ajustes</p>
        </Card>
        <Card className="space-y-1">
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Operación normal</p>
          <p className="tabular text-3xl font-bold">{data.severity.info}</p>
          <p className="text-xs text-zinc-500">Cuentas, rondas, cobros, compras recibidas</p>
        </Card>
      </section>

      {data.byActor.length > 0 && (
        <Card>
          <h2 className="font-semibold">Acciones sensibles por persona</h2>
          <p className="mb-3 text-sm text-zinc-500">
            Cuántas veces hizo cada cosa en el periodo. Una cifra alta no es una acusación: es dónde mirar primero.
          </p>
          <div className="-mx-4 overflow-x-auto">
            <table className="w-full min-w-[40rem] text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="px-4 py-2 font-medium">Persona</th>
                  {SENSITIVE_COLUMNS.map((c) => (
                    <th key={c.key} className="px-3 py-2 text-right font-medium">
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {data.byActor.map((a) => (
                  <tr key={a.actor_id ?? 'system'}>
                    <td className="px-4 py-2">
                      <span className="font-medium">{a.name}</span>
                      {a.role && <span className="ml-2 text-xs text-zinc-500">{a.role}</span>}
                    </td>
                    {SENSITIVE_COLUMNS.map((c) => {
                      const n = a.counts[c.key] ?? 0;
                      const top = Math.max(...data.byActor.map((x) => x.counts[c.key] ?? 0));
                      return (
                        <td key={c.key} className={cn('tabular px-3 py-2 text-right', n === 0 && 'text-zinc-300 dark:text-zinc-600', n > 0 && n === top && n >= 3 && 'font-bold text-amber-700 dark:text-amber-300')}>
                          {n || '·'}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Card>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h2 className="mr-auto font-semibold">Movimientos</h2>
          <span className="text-sm text-zinc-500">
            {data.total.toLocaleString(locale)} registro{data.total === 1 ? '' : 's'}
            {pages > 1 && ` · página ${data.page} de ${pages}`}
          </span>
        </div>
        {groups.length === 0 ? (
          <p className="py-10 text-center text-sm text-zinc-500">
            No hay registros con estos filtros. Prueba con «Todo, incluida la operación normal» o con un periodo más largo.
          </p>
        ) : (
          <div className="space-y-6">
            {groups.map((g) => (
              <section key={g.key}>
                <h3 className="mb-2 text-sm font-semibold capitalize text-zinc-500">{g.label}</h3>
                <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {g.rows.map((r) => {
                    const who = actorLabel(r);
                    const entries = Object.entries(r.details ?? {}).filter(([, v]) => v !== null && v !== '' && !(Array.isArray(v) && v.length === 0));
                    return (
                      <li key={r.id} className="py-2.5">
                        <details className="group">
                          <summary className="flex cursor-pointer list-none flex-wrap items-start gap-x-3 gap-y-1">
                            <span className="tabular mt-0.5 w-12 shrink-0 text-sm text-zinc-500">{time(r.at)}</span>
                            <span aria-label={SEVERITY_LABEL[r.severity]} className={cn('mt-1.5 size-2.5 shrink-0 rounded-full', DOT[r.severity])} />
                            <span className="min-w-0 flex-1 text-sm">
                              <b>{who.name}</b>
                              {who.role && <span className="text-zinc-500"> ({who.role})</span>} {describeAudit(r, money, { permissionLabels })}
                            </span>
                            <span className="flex shrink-0 gap-1.5">
                              {r.severity !== 'info' && <Badge className={SEVERITY_STYLE[r.severity]}>{SEVERITY_LABEL[r.severity]}</Badge>}
                              <Badge className="bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">{CATEGORY_LABEL[r.category]}</Badge>
                            </span>
                          </summary>
                          {entries.length > 0 && (
                            <dl className="ml-[3.75rem] mt-2 grid gap-x-4 gap-y-1 rounded-xl bg-zinc-50 p-3 text-xs sm:grid-cols-2 dark:bg-zinc-900">
                              {entries.map(([k, v]) => (
                                <div key={k} className="flex gap-2">
                                  <dt className="shrink-0 text-zinc-500">{DETAIL_LABEL[k] ?? k}:</dt>
                                  <dd className="min-w-0 break-words font-medium">{detailValue(k, v)}</dd>
                                </div>
                              ))}
                            </dl>
                          )}
                        </details>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        )}
        {pages > 1 && (
          <nav aria-label="Páginas" className="mt-5 flex items-center justify-between border-t border-zinc-100 pt-4 text-sm dark:border-zinc-800">
            {data.page > 1 ? (
              <Link className="font-semibold text-brand-600 hover:underline" href={`/admin/audit?${qs(filters, { pagina: data.page > 2 ? String(data.page - 1) : undefined })}`}>
                ← Más recientes
              </Link>
            ) : (
              <span />
            )}
            {data.page < pages && (
              <Link className="font-semibold text-brand-600 hover:underline" href={`/admin/audit?${qs(filters, { pagina: String(data.page + 1) })}`}>
                Más antiguos →
              </Link>
            )}
          </nav>
        )}
      </Card>
    </div>
  );
}
