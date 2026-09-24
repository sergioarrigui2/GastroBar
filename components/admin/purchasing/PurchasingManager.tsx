'use client';

import {
  AlertTriangle,
  CalendarClock,
  Check,
  ClipboardCopy,
  Loader2,
  MessageCircle,
  PackageCheck,
  Pencil,
  ShoppingCart,
  Sparkles,
  Trash2,
  Truck,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  deleteSupplierAction,
  discardSuggestionAction,
  receiveSuggestionAction,
  reviewSuggestionWithAiAction,
  runPurchasePlanAction,
  savePurchaseScheduleAction,
  saveSupplierAction,
  updateIngredientPurchasingAction,
} from '@/app/actions/purchasing';
import { FlashMessage, useAdminMutation } from '@/components/admin/useAdminMutation';
import { Badge, Button, Card, Input, Label, Select } from '@/components/ui/primitives';
import { groupBySupplier, supplierMessage, whatsappLink, type PurchaseLine } from '@/lib/purchasing/forecast';
import { FREQUENCY_LABEL } from '@/lib/purchasing/schedule';
import type { StoredSuggestion } from '@/lib/services/purchasing';
import { cn, formatCurrency, formatDateTime } from '@/lib/utils';
import type { Tables } from '@/types/database';

type Supplier = Tables<'suppliers'>;
type Schedule = Tables<'agent_schedules'>;
type IngredientRow = Pick<
  Tables<'ingredients'>,
  'id' | 'name' | 'unit' | 'stock_quantity' | 'min_stock' | 'cost_per_unit' | 'supplier_id' | 'pack_size' | 'pack_label'
>;

const UNIT = { g: 'g', ml: 'ml', unit: 'u' } as const;
const WEEKDAYS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const STATUS = {
  draft: { label: 'Por pedir', className: 'bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-200' },
  received: { label: 'Recibido', className: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200' },
  discarded: { label: 'Descartado', className: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300' },
} as const;
const TABS = [
  { id: 'order', label: 'Pedido', icon: ShoppingCart },
  { id: 'schedule', label: 'Horario', icon: CalendarClock },
  { id: 'suppliers', label: 'Proveedores', icon: Truck },
  { id: 'packs', label: 'Empaques', icon: PackageCheck },
] as const;

type Tenant = { name: string; currency: string; locale: string; timezone: string };

export function PurchasingManager({
  tenant,
  suppliers,
  ingredients,
  schedule,
  suggestions,
  aiAvailable,
}: {
  tenant: Tenant;
  suppliers: Supplier[];
  ingredients: IngredientRow[];
  schedule: Schedule | null;
  suggestions: StoredSuggestion[];
  aiAvailable: boolean;
}) {
  const [tab, setTab] = useState<(typeof TABS)[number]['id']>('order');
  const { pending, flash, run } = useAdminMutation();
  const money = (n: number) => formatCurrency(n, tenant.currency, tenant.locale);
  const when = (iso: string) => formatDateTime(iso, tenant.locale, tenant.timezone);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <ShoppingCart className="size-6 text-brand-600" aria-hidden /> Comprador
          </h1>
          <p className="text-sm text-zinc-500">
            Calcula qué pedir según lo que vas a vender. El cálculo no usa IA: no tiene costo.
          </p>
        </div>
        <nav aria-label="Secciones" className="flex gap-1 overflow-x-auto rounded-xl bg-zinc-100 p-1 dark:bg-zinc-900">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              aria-current={tab === id ? 'page' : undefined}
              className={cn(
                'flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-semibold',
                tab === id ? 'bg-white shadow dark:bg-zinc-800' : 'text-zinc-500',
              )}
            >
              <Icon className="size-4" aria-hidden /> {label}
            </button>
          ))}
        </nav>
      </div>

      {tab === 'order' && (
        <OrderTab
          tenant={tenant}
          suggestions={suggestions}
          money={money}
          when={when}
          pending={pending}
          run={run}
          aiAvailable={aiAvailable}
          defaultHorizon={schedule?.horizon_days ?? 7}
          goTo={setTab}
          hasSuppliers={suppliers.length > 0}
        />
      )}
      {tab === 'schedule' && <ScheduleTab schedule={schedule} when={when} pending={pending} run={run} />}
      {tab === 'suppliers' && <SuppliersTab suppliers={suppliers} pending={pending} run={run} />}
      {tab === 'packs' && <PacksTab ingredients={ingredients} suppliers={suppliers} pending={pending} run={run} />}

      <FlashMessage flash={flash} />
    </div>
  );
}

type Run = ReturnType<typeof useAdminMutation>['run'];

// ─── Pedido ────────────────────────────────────────────────────────────────────

function OrderTab({
  tenant,
  suggestions,
  money,
  when,
  pending,
  run,
  aiAvailable,
  defaultHorizon,
  goTo,
  hasSuppliers,
}: {
  tenant: Tenant;
  suggestions: StoredSuggestion[];
  money: (n: number) => string;
  when: (iso: string) => string;
  pending: boolean;
  run: Run;
  aiAvailable: boolean;
  defaultHorizon: number;
  goTo: (tab: 'schedule' | 'suppliers' | 'packs') => void;
  hasSuppliers: boolean;
}) {
  const [horizon, setHorizon] = useState(String(defaultHorizon));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const current = suggestions.find((s) => s.id === selectedId) ?? suggestions.find((s) => s.status === 'draft') ?? suggestions[0] ?? null;

  return (
    <div className="space-y-5">
      <Card className="flex flex-wrap items-end gap-3">
        <div>
          <Label htmlFor="horizon">Días que debe cubrir el pedido</Label>
          <Select id="horizon" value={horizon} onChange={(e) => setHorizon(e.target.value)} className="w-44">
            {[3, 5, 7, 10, 14, 21, 30].map((d) => (
              <option key={d} value={d}>
                {d} días
              </option>
            ))}
          </Select>
        </div>
        <Button
          disabled={pending}
          onClick={() =>
            run(() => runPurchasePlanAction({ horizon_days: Number(horizon) }), 'Pedido calculado', (id) => setSelectedId(id))
          }
        >
          {pending ? <Loader2 className="size-4 animate-spin" /> : <ShoppingCart className="size-4" />} Calcular pedido ahora
        </Button>
        <p className="min-w-0 flex-1 text-sm text-zinc-500">
          Usa las últimas 8 semanas de consumo real por receta, el patrón de cada día de la semana, festivos, mermas, tu stock y los días
          de entrega del proveedor.
        </p>
      </Card>

      {!hasSuppliers && (
        <p className="rounded-xl bg-sky-100 p-3 text-sm text-sky-900 dark:bg-sky-500/15 dark:text-sky-200">
          Consejo: registra tus{' '}
          <button type="button" className="font-semibold underline" onClick={() => goTo('suppliers')}>
            proveedores
          </button>{' '}
          y el{' '}
          <button type="button" className="font-semibold underline" onClick={() => goTo('packs')}>
            empaque de cada insumo
          </button>{' '}
          para que el pedido salga agrupado, en botellas o bultos completos y listo para enviar por WhatsApp.
        </p>
      )}

      {current ? (
        <SuggestionView key={current.id} s={current} tenant={tenant} money={money} when={when} pending={pending} run={run} aiAvailable={aiAvailable} />
      ) : (
        <Card>
          <p className="py-8 text-center text-sm text-zinc-500">Aún no hay pedidos. Calcula el primero o programa el horario del Comprador.</p>
        </Card>
      )}

      {suggestions.length > 1 && (
        <Card>
          <h2 className="mb-3 font-semibold">Pedidos anteriores</h2>
          <ul className="divide-y divide-zinc-100 text-sm dark:divide-zinc-800">
            {suggestions.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(s.id)}
                  className={cn(
                    'flex w-full flex-wrap items-center gap-x-3 gap-y-1 py-2 text-left hover:text-brand-600',
                    current?.id === s.id && 'font-semibold',
                  )}
                >
                  <Badge className={STATUS[s.status].className}>{STATUS[s.status].label}</Badge>
                  <span>{when(s.created_at)}</span>
                  <span className="text-zinc-500">{s.trigger === 'schedule' ? 'Programado' : 'Manual'}</span>
                  <span className="text-zinc-500">{s.lines.length} insumo(s)</span>
                  <span className="ml-auto tabular-nums">{money(Number(s.total_estimated))}</span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function SuggestionView({
  s,
  tenant,
  money,
  when,
  pending,
  run,
  aiAvailable,
}: {
  s: StoredSuggestion;
  tenant: Tenant;
  money: (n: number) => string;
  when: (iso: string) => string;
  pending: boolean;
  run: Run;
  aiAvailable: boolean;
}) {
  const editable = s.status === 'draft';
  const [packs, setPacks] = useState<Record<string, number>>(() => Object.fromEntries(s.lines.map((l) => [l.ingredient_id, l.packs])));
  const [copied, setCopied] = useState<string | null>(null);

  const lines: PurchaseLine[] = useMemo(
    () =>
      s.lines.map((l) => {
        const p = packs[l.ingredient_id] ?? l.packs;
        const order_qty = Math.round(p * l.pack_size * 1000) / 1000;
        return { ...l, packs: p, order_qty, est_cost: Math.round(order_qty * l.unit_cost) };
      }),
    [s.lines, packs],
  );
  const groups = groupBySupplier(lines.filter((l) => l.packs > 0));
  const total = lines.reduce((sum, l) => sum + l.est_cost, 0);
  // El modelo a veces agrega la unidad al nombre ("Limón (unit)"): se compara sin ella.
  const norm = (name: string) => name.replace(/\s*\([^)]*\)\s*$/, '').trim().toLowerCase();
  const flags = new Map((s.ai_review?.flags ?? []).map((f) => [norm(f.ingredient), f]));

  const copy = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      window.prompt('Copia el mensaje:', text);
    }
  };

  return (
    <div className="space-y-4">
      <Card className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge className={STATUS[s.status].className}>{STATUS[s.status].label}</Badge>
          <span className="text-sm text-zinc-500">
            {s.trigger === 'schedule' ? 'Programado' : 'Manual'} · {when(s.created_at)} · cubre {s.coverage_from} a {s.coverage_to}
          </span>
          <span className="ml-auto text-lg font-bold tabular-nums">{money(total)}</span>
        </div>
        {s.notes.length > 0 && (
          <ul className="space-y-1 text-sm text-zinc-600 dark:text-zinc-400">
            {s.notes.map((n, i) => (
              <li key={i} className="flex gap-2">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-500" aria-hidden /> {n}
              </li>
            ))}
          </ul>
        )}
        {s.lines.length === 0 && <p className="text-sm text-emerald-600">Con el stock actual cubres el periodo: no hace falta pedir nada.</p>}

        {s.ai_review ? (
          <div className="rounded-xl bg-violet-50 p-3 text-sm dark:bg-violet-500/10">
            <p className="mb-1 flex items-center gap-1.5 font-semibold text-violet-700 dark:text-violet-300">
              <Sparkles className="size-4" aria-hidden /> Revisión con IA
            </p>
            <p>{s.ai_review.summary}</p>
            <p className="mt-1 text-xs text-zinc-500">
              {s.ai_review.model} · USD {Number(s.ai_review.cost_usd ?? 0).toFixed(4)} · las cantidades no se cambiaron solas
            </p>
          </div>
        ) : (
          editable &&
          s.lines.length > 0 &&
          aiAvailable && (
            <Button variant="secondary" disabled={pending} onClick={() => run(() => reviewSuggestionWithAiAction(s.id), 'Revisión lista')}>
              <Sparkles className="size-4" /> Revisar con IA (opcional · Haiku, menos de USD 0,01)
            </Button>
          )
        )}
      </Card>

      {groups.map((g) => {
        const text = supplierMessage({ business: tenant.name, supplier: g.supplier_name, lines: g.lines });
        const wa = whatsappLink(g.supplier_phone, text);
        return (
          <Card key={g.supplier_id ?? 'none'} className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Truck className="size-5 text-zinc-400" aria-hidden />
              <h3 className="mr-auto font-semibold">{g.supplier_name}</h3>
              <span className="text-sm font-semibold tabular-nums">{money(g.total)}</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm tabular-nums">
                <thead className="text-left text-xs uppercase tracking-wide text-zinc-500">
                  <tr className="border-b border-zinc-200 dark:border-zinc-800">
                    <th className="py-2 pr-3 font-semibold">Insumo</th>
                    <th className="py-2 pr-3 text-right font-semibold">Tienes</th>
                    <th className="py-2 pr-3 text-right font-semibold">Se usará</th>
                    <th className="py-2 pr-3 text-right font-semibold">Pedir</th>
                    <th className="py-2 text-right font-semibold">Costo</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {g.lines.map((l) => {
                    const flag = flags.get(norm(l.name));
                    return (
                      <tr key={l.ingredient_id} className="align-top">
                        <td className="py-2 pr-3">
                          <p className="font-medium">
                            {l.name}{' '}
                            {l.urgent && <Badge className="bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-200">Urgente</Badge>}{' '}
                            {l.confidence === 'baja' && <Badge className="bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">Poca historia</Badge>}
                          </p>
                          <p className="max-w-md text-xs text-zinc-500">{l.reason}</p>
                          {flag && (
                            <p className="mt-1 max-w-md text-xs font-medium text-violet-700 dark:text-violet-300">
                              IA · {flag.suggestion}: {flag.note}
                            </p>
                          )}
                        </td>
                        <td className="py-2 pr-3 text-right">
                          {Math.round(l.stock * 10) / 10} {UNIT[l.unit]}
                          {l.days_left !== null && <span className="block text-xs text-zinc-500">≈ {l.days_left} días</span>}
                        </td>
                        <td className="py-2 pr-3 text-right">
                          {Math.round(l.demand)} {UNIT[l.unit]}
                        </td>
                        <td className="py-2 pr-3 text-right">
                          {editable ? (
                            <span className="inline-flex items-center gap-1">
                              <Input
                                type="number"
                                min={0}
                                step={1}
                                value={packs[l.ingredient_id] ?? l.packs}
                                onChange={(e) => setPacks((p) => ({ ...p, [l.ingredient_id]: Math.max(0, Math.round(Number(e.target.value) || 0)) }))}
                                className="h-9 w-20 text-right"
                                aria-label={`Cantidad de ${l.name}`}
                              />
                              <span className="text-xs text-zinc-500">× {l.pack_label ?? `${l.pack_size} ${UNIT[l.unit]}`}</span>
                            </span>
                          ) : (
                            <span>
                              {l.packs} × {l.pack_label ?? `${l.pack_size} ${UNIT[l.unit]}`}
                            </span>
                          )}
                        </td>
                        <td className="py-2 text-right">{money(l.est_cost)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {editable && g.supplier_id && (
              <div className="flex flex-wrap gap-2">
                {wa ? (
                  <a
                    href={wa}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex h-10 items-center gap-2 rounded-xl bg-emerald-600 px-4 text-sm font-semibold text-white hover:bg-emerald-700"
                  >
                    <MessageCircle className="size-4" /> Enviar por WhatsApp
                  </a>
                ) : (
                  <span className="self-center text-xs text-zinc-500">Agrega el WhatsApp del proveedor para enviarlo con un toque.</span>
                )}
                <Button variant="ghost" onClick={() => copy(g.supplier_id ?? 'none', text)}>
                  {copied === (g.supplier_id ?? 'none') ? <Check className="size-4" /> : <ClipboardCopy className="size-4" />}
                  {copied === (g.supplier_id ?? 'none') ? 'Copiado' : 'Copiar mensaje'}
                </Button>
              </div>
            )}
          </Card>
        );
      })}

      {editable && s.lines.length > 0 && (
        <Card className="flex flex-wrap items-center gap-3">
          <p className="mr-auto text-sm text-zinc-600 dark:text-zinc-400">
            Cuando llegue la mercancía, ajusta las cantidades si algo cambió y regístrala: se suma al inventario como compra.
          </p>
          <Button variant="ghost" disabled={pending} onClick={() => run(() => discardSuggestionAction(s.id), 'Pedido descartado')}>
            Descartar
          </Button>
          <Button
            variant="success"
            disabled={pending}
            onClick={() =>
              run(
                () =>
                  receiveSuggestionAction({
                    id: s.id,
                    quantities: Object.fromEntries(lines.map((l) => [l.ingredient_id, l.order_qty])),
                  }),
                'Mercancía registrada en el inventario',
              )
            }
          >
            <PackageCheck className="size-4" /> Registrar recepción
          </Button>
        </Card>
      )}
    </div>
  );
}

// ─── Horario ───────────────────────────────────────────────────────────────────

function ScheduleTab({ schedule, when, pending, run }: { schedule: Schedule | null; when: (iso: string) => string; pending: boolean; run: Run }) {
  const [form, setForm] = useState({
    is_active: schedule?.is_active ?? false,
    frequency: schedule?.frequency ?? 'weekly',
    weekday: schedule?.weekday ?? 1,
    day_of_month: schedule?.day_of_month ?? 1,
    hour: schedule?.hour ?? 7,
    horizon_days: schedule?.horizon_days ?? 7,
  });
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <Card className="max-w-2xl space-y-5">
      <div>
        <h2 className="font-semibold">¿Cuándo trabaja el Comprador?</h2>
        <p className="text-sm text-zinc-500">
          A la hora que elijas calcula el pedido y lo deja listo en esta pantalla y en tu Equipo IA. No usa IA: no tiene costo.
        </p>
      </div>
      <label className="flex items-center gap-3">
        <input type="checkbox" checked={form.is_active} onChange={(e) => set('is_active', e.target.checked)} className="size-5 accent-brand-600" />
        <span className="font-medium">Activar el pedido automático</span>
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="frequency">Frecuencia</Label>
          <Select id="frequency" value={form.frequency} onChange={(e) => set('frequency', e.target.value as typeof form.frequency)}>
            {Object.entries(FREQUENCY_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </div>
        {(form.frequency === 'weekly' || form.frequency === 'biweekly') && (
          <div>
            <Label htmlFor="weekday">Día</Label>
            <Select id="weekday" value={form.weekday} onChange={(e) => set('weekday', Number(e.target.value))}>
              {WEEKDAYS.map((d, i) => (
                <option key={d} value={i + 1}>
                  {d}
                </option>
              ))}
            </Select>
          </div>
        )}
        {form.frequency === 'monthly' && (
          <div>
            <Label htmlFor="dom">Día del mes</Label>
            <Select id="dom" value={form.day_of_month} onChange={(e) => set('day_of_month', Number(e.target.value))}>
              {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </Select>
          </div>
        )}
        <div>
          <Label htmlFor="hour">Hora</Label>
          <Select id="hour" value={form.hour} onChange={(e) => set('hour', Number(e.target.value))}>
            {Array.from({ length: 24 }, (_, h) => h).map((h) => (
              <option key={h} value={h}>
                {String(h).padStart(2, '0')}:00
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="sched-horizon">Días que debe cubrir cada pedido</Label>
          <Select id="sched-horizon" value={form.horizon_days} onChange={(e) => set('horizon_days', Number(e.target.value))}>
            {[3, 5, 7, 10, 14, 15, 21, 30].map((d) => (
              <option key={d} value={d}>
                {d} días
              </option>
            ))}
          </Select>
        </div>
      </div>
      {schedule && (
        <dl className="grid gap-1 text-sm sm:grid-cols-[10rem_1fr]">
          <dt className="text-zinc-500">Próxima ejecución</dt>
          <dd>{schedule.is_active && schedule.next_run_at ? when(schedule.next_run_at) : '—'}</dd>
          <dt className="text-zinc-500">Última ejecución</dt>
          <dd>{schedule.last_run_at ? when(schedule.last_run_at) : 'Nunca'}</dd>
          {schedule.last_error && (
            <>
              <dt className="text-red-600">Último error</dt>
              <dd className="text-red-600">{schedule.last_error}</dd>
            </>
          )}
        </dl>
      )}
      <Button disabled={pending} onClick={() => run(() => savePurchaseScheduleAction(form), 'Horario guardado')}>
        Guardar horario
      </Button>
    </Card>
  );
}

// ─── Proveedores ───────────────────────────────────────────────────────────────

const emptySupplier = { id: undefined as string | undefined, name: '', contact_name: '', phone: '', email: '', lead_time_days: 1 };

function SuppliersTab({ suppliers, pending, run }: { suppliers: Supplier[]; pending: boolean; run: Run }) {
  const [form, setForm] = useState(emptySupplier);
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="grid gap-5 lg:grid-cols-5">
      <Card className="space-y-3 lg:col-span-2">
        <h2 className="font-semibold">{form.id ? 'Editar proveedor' : 'Nuevo proveedor'}</h2>
        <div>
          <Label htmlFor="s-name">Nombre</Label>
          <Input id="s-name" value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Ej. Licores del Valle" />
        </div>
        <div>
          <Label htmlFor="s-contact">Contacto</Label>
          <Input id="s-contact" value={form.contact_name ?? ''} onChange={(e) => set('contact_name', e.target.value)} placeholder="Opcional" />
        </div>
        <div>
          <Label htmlFor="s-phone">WhatsApp (con indicativo)</Label>
          <Input id="s-phone" inputMode="tel" value={form.phone ?? ''} onChange={(e) => set('phone', e.target.value)} placeholder="573001234567" />
        </div>
        <div>
          <Label htmlFor="s-email">Correo</Label>
          <Input id="s-email" type="email" value={form.email ?? ''} onChange={(e) => set('email', e.target.value)} placeholder="Opcional" />
        </div>
        <div>
          <Label htmlFor="s-lead">Días que tarda en entregar</Label>
          <Input id="s-lead" type="number" min={0} max={30} value={form.lead_time_days} onChange={(e) => set('lead_time_days', Number(e.target.value))} />
        </div>
        <div className="flex gap-2">
          <Button
            disabled={pending || !form.name.trim()}
            onClick={() => run(() => saveSupplierAction(form), form.id ? 'Proveedor actualizado' : 'Proveedor creado', () => setForm(emptySupplier))}
          >
            Guardar
          </Button>
          {form.id && (
            <Button variant="ghost" onClick={() => setForm(emptySupplier)}>
              Cancelar
            </Button>
          )}
        </div>
      </Card>
      <Card className="lg:col-span-3">
        <h2 className="mb-3 font-semibold">Tus proveedores</h2>
        {suppliers.length === 0 ? (
          <p className="py-6 text-center text-sm text-zinc-500">Aún no has registrado proveedores.</p>
        ) : (
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {suppliers.map((s) => (
              <li key={s.id} className="flex items-center gap-3 py-2 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{s.name}</p>
                  <p className="text-xs text-zinc-500">
                    {[s.contact_name, s.phone, s.email].filter(Boolean).join(' · ') || 'Sin datos de contacto'} · entrega en {s.lead_time_days} día(s)
                  </p>
                </div>
                <button
                  type="button"
                  aria-label={`Editar ${s.name}`}
                  onClick={() =>
                    setForm({
                      id: s.id,
                      name: s.name,
                      contact_name: s.contact_name ?? '',
                      phone: s.phone ?? '',
                      email: s.email ?? '',
                      lead_time_days: s.lead_time_days,
                    })
                  }
                  className="grid size-9 place-items-center rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  <Pencil className="size-4" />
                </button>
                <button
                  type="button"
                  aria-label={`Eliminar ${s.name}`}
                  disabled={pending}
                  onClick={() => run(() => deleteSupplierAction(s.id), 'Proveedor eliminado')}
                  className="grid size-9 place-items-center rounded-lg text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10"
                >
                  <Trash2 className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

// ─── Empaques ──────────────────────────────────────────────────────────────────

function PacksTab({ ingredients, suppliers, pending, run }: { ingredients: IngredientRow[]; suppliers: Supplier[]; pending: boolean; run: Run }) {
  return (
    <Card className="space-y-3">
      <div>
        <h2 className="font-semibold">Cómo compras cada insumo</h2>
        <p className="text-sm text-zinc-500">
          El empaque es la cantidad que trae cada unidad que compras, en la unidad de la receta. Ej.: Ron en ml → "botella 750 ml" y
          tamaño 750. Así el pedido sale en botellas o bultos completos.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-zinc-500">
            <tr className="border-b border-zinc-200 dark:border-zinc-800">
              <th className="py-2 pr-3 font-semibold">Insumo</th>
              <th className="py-2 pr-3 font-semibold">Proveedor</th>
              <th className="py-2 pr-3 font-semibold">Nombre del empaque</th>
              <th className="py-2 pr-3 font-semibold">Tamaño</th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {ingredients.map((i) => (
              <PackRow key={i.id} ingredient={i} suppliers={suppliers} pending={pending} run={run} />
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function PackRow({ ingredient: i, suppliers, pending, run }: { ingredient: IngredientRow; suppliers: Supplier[]; pending: boolean; run: Run }) {
  const [supplier, setSupplier] = useState(i.supplier_id ?? '');
  const [label, setLabel] = useState(i.pack_label ?? '');
  const [size, setSize] = useState(i.pack_size ? String(i.pack_size) : '');
  const dirty = supplier !== (i.supplier_id ?? '') || label !== (i.pack_label ?? '') || size !== (i.pack_size ? String(i.pack_size) : '');

  return (
    <tr>
      <td className="py-2 pr-3 font-medium">
        {i.name} <span className="text-xs text-zinc-500">({UNIT[i.unit]})</span>
      </td>
      <td className="py-2 pr-3">
        <Select value={supplier} onChange={(e) => setSupplier(e.target.value)} className="h-9 min-w-40" aria-label={`Proveedor de ${i.name}`}>
          <option value="">Sin proveedor</option>
          {suppliers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
      </td>
      <td className="py-2 pr-3">
        <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={i.unit === 'unit' ? 'caja x24' : `bolsa 1 ${i.unit === 'g' ? 'kg' : 'L'}`} className="h-9 min-w-36" aria-label={`Empaque de ${i.name}`} />
      </td>
      <td className="py-2 pr-3">
        <span className="inline-flex items-center gap-1">
          <Input type="number" min={0} step="any" value={size} onChange={(e) => setSize(e.target.value)} placeholder={i.unit === 'unit' ? '24' : '1000'} className="h-9 w-24" aria-label={`Tamaño del empaque de ${i.name}`} />
          <span className="text-xs text-zinc-500">{UNIT[i.unit]}</span>
        </span>
      </td>
      <td className="py-2 text-right">
        <Button
          size="sm"
          variant={dirty ? 'primary' : 'ghost'}
          disabled={pending || !dirty}
          onClick={() =>
            run(
              () =>
                updateIngredientPurchasingAction({
                  id: i.id,
                  supplier_id: supplier || null,
                  pack_label: label.trim() || null,
                  pack_size: size ? Number(size) : null,
                }),
              `${i.name} actualizado`,
            )
          }
        >
          Guardar
        </Button>
      </td>
    </tr>
  );
}
