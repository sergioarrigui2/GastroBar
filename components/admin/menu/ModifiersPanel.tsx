'use client';

import { Plus, Save, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { deleteEntityAction, saveModifierAction } from '@/app/actions/catalog';
import { Button, Card, Input, Select } from '@/components/ui/primitives';
import type { CatalogSnapshot } from '@/lib/services/catalog';
import { cn } from '@/lib/utils';
import type { Tables } from '@/types/database';
import { FlashMessage, toNumber, useAdminMutation } from '../useAdminMutation';
import type { CatalogLookups } from './MenuManager';

type Modifier = Tables<'modifiers'>;

/** Alcance codificado: "all", "c:<categoría>" o "p:<producto>". */
const scopeOf = (m: Pick<Modifier, 'product_id' | 'category_id'>) =>
  m.product_id ? `p:${m.product_id}` : m.category_id ? `c:${m.category_id}` : 'all';
const scopeToIds = (scope: string) => ({
  product_id: scope.startsWith('p:') ? scope.slice(2) : null,
  category_id: scope.startsWith('c:') ? scope.slice(2) : null,
});

/** Selector de alcance: todo el menú, una categoría o un producto. */
function ScopeSelect({ value, onChange, catalog }: { value: string; onChange: (v: string) => void; catalog: CatalogSnapshot }) {
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)} aria-label="Aplica a">
      <option value="all">Todos los productos</option>
      <optgroup label="Categoría">
        {catalog.categories.map((c) => (
          <option key={c.id} value={`c:${c.id}`}>
            {c.name}
          </option>
        ))}
      </optgroup>
      <optgroup label="Producto">
        {catalog.products.map((p) => (
          <option key={p.id} value={`p:${p.id}`}>
            {p.name}
          </option>
        ))}
      </optgroup>
    </Select>
  );
}

export function ModifiersPanel({ catalog, lookups }: { catalog: CatalogSnapshot; lookups: CatalogLookups }) {
  const { pending, flash, run } = useAdminMutation();
  const [name, setName] = useState('');
  const [price, setPrice] = useState('0');
  const [scope, setScope] = useState('all');

  const groups = useMemo(() => {
    const byScope = new Map<string, Modifier[]>();
    for (const m of catalog.modifiers) byScope.set(scopeOf(m), [...(byScope.get(scopeOf(m)) ?? []), m]);
    const label = (s: string) => {
      if (s === 'all') return 'Todos los productos';
      if (s.startsWith('c:')) return `Categoría · ${catalog.categories.find((c) => c.id === s.slice(2))?.name ?? '—'}`;
      return `Producto · ${catalog.products.find((p) => p.id === s.slice(2))?.name ?? '—'}`;
    };
    return [...byScope.entries()]
      .map(([s, mods]) => ({ scope: s, label: label(s), mods }))
      .sort((a, b) => a.scope[0]!.localeCompare(b.scope[0]!) || a.label.localeCompare(b.label));
  }, [catalog]);

  const create = () => {
    if (!name.trim()) return;
    run(
      () => saveModifierAction({ ...scopeToIds(scope), name, price_delta: toNumber(price) || 0 }),
      'Modificador creado',
      () => {
        setName('');
        setPrice('0');
      },
    );
  };

  return (
    <>
      <Card>
        <p className="mb-3 text-sm text-zinc-500">
          Opciones rápidas que el mesero toca al comandar ("sin hielo", "término medio", "doble shot"). Pueden aplicar a un
          producto, a toda una categoría o a todo el menú, y sumar un costo extra.
        </p>
        <div className="grid gap-2 sm:grid-cols-[1fr_8rem_14rem_auto]">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder='Ej. "Sin hielo"' aria-label="Nombre" onKeyDown={(e) => e.key === 'Enter' && create()} />
          <Input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" aria-label="Costo extra" title="Costo extra" />
          <ScopeSelect value={scope} onChange={setScope} catalog={catalog} />
          <Button onClick={create} disabled={pending || !name.trim()}>
            <Plus className="size-4" /> Crear
          </Button>
        </div>
      </Card>

      {groups.map((g) => (
        <Card key={g.scope} className="p-0">
          <h3 className="border-b border-zinc-100 px-4 py-2.5 text-sm font-semibold dark:border-zinc-800">{g.label}</h3>
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {g.mods.map((m) => (
              <ModifierRow key={`${m.id}-${m.name}-${m.price_delta}-${m.is_active}-${scopeOf(m)}`} modifier={m} pending={pending} run={run} catalog={catalog} money={lookups.money} />
            ))}
          </ul>
        </Card>
      ))}
      {groups.length === 0 && <Card className="py-10 text-center text-zinc-500">Aún no hay modificadores.</Card>}
      <FlashMessage flash={flash} />
    </>
  );
}

function ModifierRow({
  modifier,
  pending,
  run,
  catalog,
  money,
}: {
  modifier: Modifier;
  pending: boolean;
  run: ReturnType<typeof useAdminMutation>['run'];
  catalog: CatalogSnapshot;
  money: (n: number) => string;
}) {
  const [name, setName] = useState(modifier.name);
  const [price, setPrice] = useState(String(modifier.price_delta));
  const [scope, setScope] = useState(scopeOf(modifier));
  const [active, setActive] = useState(modifier.is_active);
  const dirty = name !== modifier.name || toNumber(price) !== modifier.price_delta || scope !== scopeOf(modifier) || active !== modifier.is_active;

  return (
    <li className={cn('grid items-center gap-2 px-4 py-2.5 sm:grid-cols-[1fr_8rem_14rem_auto_auto]', !active && 'opacity-60')}>
      <Input value={name} onChange={(e) => setName(e.target.value)} aria-label="Nombre" />
      <Input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" aria-label="Costo extra" title={money(toNumber(price) || 0)} />
      <ScopeSelect value={scope} onChange={setScope} catalog={catalog} />
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" className="size-5 accent-emerald-600" checked={active} onChange={(e) => setActive(e.target.checked)} />
        Activo
      </label>
      <div className="flex gap-1">
        <Button
          size="sm"
          disabled={pending || !dirty || !name.trim()}
          onClick={() =>
            run(
              () => saveModifierAction({ id: modifier.id, ...scopeToIds(scope), name, price_delta: toNumber(price) || 0, sort_order: modifier.sort_order, is_active: active }),
              'Modificador guardado',
            )
          }
        >
          <Save className="size-4" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          aria-label={`Eliminar ${modifier.name}`}
          disabled={pending}
          onClick={() => confirm(`¿Eliminar "${modifier.name}"?`) && run(() => deleteEntityAction('modifiers', modifier.id), 'Modificador eliminado')}
        >
          <Trash2 className="size-4 text-red-600" />
        </Button>
      </div>
    </li>
  );
}
