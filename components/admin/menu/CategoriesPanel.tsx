'use client';

import { ChefHat, Martini, Plus, Save, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { deleteEntityAction, saveCategoryAction } from '@/app/actions/catalog';
import { Button, Card, Input, Select } from '@/components/ui/primitives';
import type { CatalogSnapshot } from '@/lib/services/catalog';
import { cn } from '@/lib/utils';
import type { Station, Tables } from '@/types/database';
import { FlashMessage, toNumber, useAdminMutation } from '../useAdminMutation';

type Category = Tables<'categories'>;

export function CategoriesPanel({ catalog }: { catalog: CatalogSnapshot }) {
  const { pending, flash, run } = useAdminMutation();
  const [name, setName] = useState('');
  const [station, setStation] = useState<Station>('kitchen');
  const counts = new Map<string, number>();
  for (const p of catalog.products) counts.set(p.category_id, (counts.get(p.category_id) ?? 0) + 1);

  const create = () => {
    if (!name.trim()) return;
    run(
      () => saveCategoryAction({ name, station, sort_order: catalog.categories.length + 1 }),
      'Categoría creada',
      () => setName(''),
    );
  };

  return (
    <>
      <Card>
        <p className="mb-3 text-sm text-zinc-500">
          La <b>estación</b> decide a qué pantalla KDS llega cada producto de la categoría: <b>Barra</b> (bebidas y
          coctelería) o <b>Cocina</b> (alimentos).
        </p>
        <div className="grid gap-2 sm:grid-cols-[1fr_10rem_auto]">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nueva categoría, ej. Tapas" aria-label="Nombre de la categoría" onKeyDown={(e) => e.key === 'Enter' && create()} />
          <Select value={station} onChange={(e) => setStation(e.target.value as Station)} aria-label="Estación">
            <option value="kitchen">Cocina</option>
            <option value="bar">Barra</option>
          </Select>
          <Button onClick={create} disabled={pending || !name.trim()}>
            <Plus className="size-4" /> Crear
          </Button>
        </div>
      </Card>

      <Card className="p-0">
        <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {catalog.categories.map((c) => (
            <CategoryRow key={`${c.id}-${c.name}-${c.station}-${c.sort_order}-${c.is_active}`} category={c} productCount={counts.get(c.id) ?? 0} pending={pending} run={run} />
          ))}
          {catalog.categories.length === 0 && <li className="px-4 py-10 text-center text-zinc-500">Aún no hay categorías.</li>}
        </ul>
      </Card>
      <FlashMessage flash={flash} />
    </>
  );
}

function CategoryRow({
  category,
  productCount,
  pending,
  run,
}: {
  category: Category;
  productCount: number;
  pending: boolean;
  run: ReturnType<typeof useAdminMutation>['run'];
}) {
  const [name, setName] = useState(category.name);
  const [station, setStation] = useState<Station>(category.station);
  const [sort, setSort] = useState(String(category.sort_order));
  const [active, setActive] = useState(category.is_active);
  const dirty = name !== category.name || station !== category.station || sort !== String(category.sort_order) || active !== category.is_active;
  const Icon = station === 'bar' ? Martini : ChefHat;

  return (
    <li className={cn('grid items-center gap-2 px-4 py-3 sm:grid-cols-[auto_1fr_9rem_5rem_auto_auto]', !active && 'opacity-60')}>
      <Icon className="hidden size-5 text-brand-600 sm:block" />
      <div>
        <Input value={name} onChange={(e) => setName(e.target.value)} aria-label="Nombre" />
        <p className="mt-1 text-xs text-zinc-500">{productCount} producto(s)</p>
      </div>
      <Select value={station} onChange={(e) => setStation(e.target.value as Station)} aria-label="Estación">
        <option value="kitchen">Cocina</option>
        <option value="bar">Barra</option>
      </Select>
      <Input value={sort} onChange={(e) => setSort(e.target.value)} inputMode="numeric" aria-label="Orden" title="Orden" />
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" className="size-5 accent-emerald-600" checked={active} onChange={(e) => setActive(e.target.checked)} />
        Activa
      </label>
      <div className="flex gap-1">
        <Button
          size="sm"
          disabled={pending || !dirty || !name.trim()}
          onClick={() =>
            run(
              () => saveCategoryAction({ id: category.id, name, station, sort_order: Math.max(0, Math.trunc(toNumber(sort) || 0)), is_active: active }),
              'Categoría guardada',
            )
          }
        >
          <Save className="size-4" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          aria-label={`Eliminar ${category.name}`}
          disabled={pending}
          onClick={() => {
            if (productCount > 0) {
              alert('La categoría tiene productos. Muévelos a otra categoría o desactívala.');
              return;
            }
            if (confirm(`¿Eliminar la categoría "${category.name}"?`)) run(() => deleteEntityAction('categories', category.id), 'Categoría eliminada');
          }}
        >
          <Trash2 className="size-4 text-red-600" />
        </Button>
      </div>
    </li>
  );
}
