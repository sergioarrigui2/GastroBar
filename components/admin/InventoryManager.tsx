'use client';

import { AlertTriangle, Pencil, Plus, Search, Wine } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useActionState, useMemo, useState } from 'react';
import { recordInventoryMovementAction, type FormState } from '@/app/actions/admin';
import { Badge, Button, Card, Input, Label, Select } from '@/components/ui/primitives';
import { useRealtimeRefresh } from '@/components/ui/useRealtimeRefresh';
import { IngredientEditor } from './IngredientEditor';
import type { InventoryOverview } from '@/lib/services/inventory';
import { cn, formatCurrency, formatQuantity } from '@/lib/utils';
import type { MovementType } from '@/types/database';
import type { Ingredient } from '@/types/domain';

type Filter = 'all' | 'liquor' | 'low';

const MOVEMENT_LABELS: Record<MovementType, { label: string; className: string }> = {
  sale: { label: 'Venta', className: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300' },
  sale_reversal: { label: 'Anulación', className: 'bg-sky-100 text-sky-800 dark:bg-sky-500/20 dark:text-sky-200' },
  waste: { label: 'Merma', className: 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300' },
  purchase: { label: 'Compra', className: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200' },
  adjustment: { label: 'Ajuste', className: 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200' },
};

export function InventoryManager({
  tenantId,
  overview,
  currency,
  locale,
}: {
  tenantId: string;
  overview: InventoryOverview;
  currency: string;
  locale: string;
}) {
  const router = useRouter();
  const money = (n: number) => formatCurrency(n, currency, locale);
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [state, action, pending] = useActionState<FormState, FormData>(recordInventoryMovementAction, null);
  const [type, setType] = useState<'waste' | 'purchase' | 'adjustment'>('waste');
  const [editing, setEditing] = useState<Ingredient | 'new' | null>(null);

  useRealtimeRefresh({
    channel: `inventory:${tenantId}`,
    subscriptions: [{ table: 'ingredients', filter: `tenant_id=eq.${tenantId}` }],
    onRefresh: () => router.refresh(),
    debounceMs: 1000,
  });

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return overview.ingredients.filter(
      (i) =>
        (filter === 'all' || (filter === 'liquor' ? i.is_liquor : i.stock_quantity <= i.min_stock)) &&
        (!term || i.name.toLowerCase().includes(term)),
    );
  }, [overview.ingredients, filter, search]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="mr-auto text-2xl font-bold">Inventario</h1>
        <Button onClick={() => setEditing('new')}>
          <Plus className="size-4" /> Nuevo insumo
        </Button>
      </div>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card>
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Valor en stock</p>
          <p className="tabular mt-1 text-2xl font-bold">{money(overview.stockValue)}</p>
        </Card>
        <Card>
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Insumos bajo mínimo</p>
          <p className={cn('tabular mt-1 text-2xl font-bold', overview.lowStockCount > 0 && 'text-red-600')}>
            {overview.lowStockCount}
          </p>
        </Card>
        <Card>
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Mermas 7 días</p>
          <p className="tabular mt-1 text-2xl font-bold">{money(overview.waste.last7DaysCost)}</p>
        </Card>
        <Card>
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Mayor merma</p>
          <p className="mt-1 truncate text-lg font-bold">{overview.waste.byIngredient[0]?.name ?? '—'}</p>
          {overview.waste.byIngredient[0] && (
            <p className="tabular text-xs text-zinc-500">{money(overview.waste.byIngredient[0].cost)}</p>
          )}
        </Card>
      </section>

      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <label className="relative min-w-48 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-400" />
              <Input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar insumo…"
                aria-label="Buscar insumo"
                className="pl-9"
              />
            </label>
            {(
              [
                ['all', 'Todos'],
                ['liquor', 'Licores'],
                ['low', 'Stock bajo'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setFilter(key)}
                aria-pressed={filter === key}
                className={cn(
                  'h-11 rounded-xl px-4 text-sm font-semibold',
                  filter === key ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900' : 'bg-zinc-100 dark:bg-zinc-800',
                )}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="-mx-4 overflow-x-auto">
            <table className="w-full min-w-[36rem] text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="px-4 py-2 font-medium">Insumo</th>
                  <th className="px-4 py-2 text-right font-medium">Stock</th>
                  <th className="px-4 py-2 text-right font-medium">Mínimo</th>
                  <th className="px-4 py-2 text-right font-medium">Costo / u</th>
                  <th className="px-4 py-2 text-right font-medium">Valor</th>
                  <th className="px-2 py-2" />
                </tr>
              </thead>
              <tbody className="tabular divide-y divide-zinc-100 dark:divide-zinc-800">
                {rows.map((i) => {
                  const low = i.stock_quantity <= i.min_stock;
                  const pct = i.min_stock > 0 ? Math.min(100, (i.stock_quantity / (i.min_stock * 3)) * 100) : 100;
                  return (
                    <tr key={i.id} className={cn(low && 'bg-red-50/60 dark:bg-red-500/5')}>
                      <td className="px-4 py-2.5">
                        <span className="flex items-center gap-2 font-medium">
                          {i.is_liquor && <Wine className="size-4 text-brand-600" aria-label="Licor" />}
                          {i.name}
                          {low && (
                            <Badge className="bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300">
                              <AlertTriangle className="size-3" /> Bajo
                            </Badge>
                          )}
                        </span>
                        <span className="mt-1 block h-1.5 w-32 rounded-full bg-zinc-100 dark:bg-zinc-800" aria-hidden>
                          <span
                            className={cn('block h-full rounded-full', low ? 'bg-red-500' : 'bg-emerald-500')}
                            style={{ width: `${Math.max(2, pct)}%` }}
                          />
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right font-semibold">{formatQuantity(i.stock_quantity, i.unit)}</td>
                      <td className="px-4 py-2.5 text-right text-zinc-500">{formatQuantity(i.min_stock, i.unit)}</td>
                      <td className="px-4 py-2.5 text-right text-zinc-500">
                        {money(i.cost_per_unit * (i.unit === 'unit' ? 1 : 1000))}
                        <span className="text-xs"> /{i.unit === 'unit' ? 'u' : i.unit === 'g' ? 'kg' : 'L'}</span>
                      </td>
                      <td className="px-4 py-2.5 text-right">{money(Math.max(0, i.stock_quantity) * i.cost_per_unit)}</td>
                      <td className="px-2 py-2.5 text-right">
                        <Button variant="ghost" size="sm" onClick={() => setEditing(i)} aria-label={`Editar ${i.name}`}>
                          <Pencil className="size-4" />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-zinc-500">
                      Sin insumos para este filtro.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>

        <div className="space-y-6">
          <Card>
            <h2 className="mb-3 font-semibold">Registrar movimiento</h2>
            <form action={action} className="space-y-3">
              <div className="grid grid-cols-3 gap-1 rounded-xl bg-zinc-100 p-1 dark:bg-zinc-800">
                {(['waste', 'purchase', 'adjustment'] as const).map((t) => (
                  <label
                    key={t}
                    className={cn(
                      'flex h-9 cursor-pointer items-center justify-center rounded-lg text-sm font-semibold',
                      type === t ? 'bg-white shadow dark:bg-zinc-950' : 'text-zinc-500',
                    )}
                  >
                    <input type="radio" name="type" value={t} checked={type === t} onChange={() => setType(t)} className="sr-only" />
                    {MOVEMENT_LABELS[t].label}
                  </label>
                ))}
              </div>
              <div>
                <Label htmlFor="ingredient_id">Insumo</Label>
                <Select id="ingredient_id" name="ingredient_id" required defaultValue="">
                  <option value="" disabled>
                    Selecciona…
                  </option>
                  {overview.ingredients.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name} ({i.unit})
                    </option>
                  ))}
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="quantity">{type === 'adjustment' ? 'Cantidad (±)' : 'Cantidad'}</Label>
                  <Input id="quantity" name="quantity" inputMode="decimal" required placeholder="g / ml / u" />
                </div>
                {type === 'purchase' && (
                  <div>
                    <Label htmlFor="unit_cost">Costo por g/ml/u</Label>
                    <Input id="unit_cost" name="unit_cost" inputMode="decimal" placeholder="0.08" />
                  </div>
                )}
              </div>
              <div>
                <Label htmlFor="reason">{type === 'waste' ? 'Motivo (obligatorio)' : 'Nota'}</Label>
                <Input
                  id="reason"
                  name="reason"
                  required={type === 'waste'}
                  placeholder={type === 'waste' ? 'Botella rota, vencido, error de preparación…' : 'Proveedor, factura…'}
                />
              </div>
              {state && (
                <p role="status" className={cn('text-sm font-medium', state.ok ? 'text-emerald-600' : 'text-red-600')}>
                  {state.message}
                </p>
              )}
              <Button type="submit" className="w-full" disabled={pending}>
                {pending ? 'Guardando…' : 'Registrar'}
              </Button>
            </form>
          </Card>

          <Card>
            <h2 className="mb-3 font-semibold">Últimos movimientos</h2>
            <ul className="space-y-2 text-sm">
              {overview.movements.slice(0, 15).map((m) => (
                <li key={m.id} className="flex items-start gap-2">
                  <Badge className={MOVEMENT_LABELS[m.movement_type].className}>{MOVEMENT_LABELS[m.movement_type].label}</Badge>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{m.ingredient_name}</span>
                    {m.reason && <span className="block truncate text-xs text-zinc-500">{m.reason}</span>}
                  </span>
                  <span className={cn('tabular font-semibold', m.quantity < 0 ? 'text-red-600' : 'text-emerald-600')}>
                    {m.quantity > 0 ? '+' : ''}
                    {m.quantity}
                  </span>
                </li>
              ))}
              {overview.movements.length === 0 && <li className="text-zinc-500">Sin movimientos manuales.</li>}
            </ul>
          </Card>
        </div>
      </div>
      {editing && (
        <IngredientEditor
          key={editing === 'new' ? 'new' : editing.id}
          ingredient={editing === 'new' ? null : editing}
          currency={currency}
          locale={locale}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
