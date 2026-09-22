'use client';

import { FlaskConical, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { deleteEntityAction, saveSubRecipeAction } from '@/app/actions/catalog';
import { Button, Card, Input, Label, Select } from '@/components/ui/primitives';
import { Sheet } from '@/components/ui/Sheet';
import { subRecipeBatchCost, subRecipeUnitCost } from '@/lib/catalog/costing';
import type { CatalogSnapshot } from '@/lib/services/catalog';
import { formatUnitCost } from '@/lib/utils';
import type { MeasureUnit } from '@/types/database';
import { FlashMessage, toNumber, useAdminMutation } from '../useAdminMutation';
import type { CatalogLookups } from './MenuManager';
import { linesToRecipe, newLineKey, RecipeEditor, type DraftLine } from './RecipeEditor';

type SubRecipe = CatalogSnapshot['subRecipes'][number];
const UNIT: Record<MeasureUnit, string> = { g: 'g', ml: 'ml', unit: 'u' };

export function SubRecipesPanel({ catalog, lookups }: { catalog: CatalogSnapshot; lookups: CatalogLookups }) {
  const { money, ingredientMap } = lookups;
  const [editing, setEditing] = useState<SubRecipe | 'new' | null>(null);
  const usage = new Map<string, number>();
  for (const r of catalog.recipes) if (r.sub_recipe_id) usage.set(r.sub_recipe_id, (usage.get(r.sub_recipe_id) ?? 0) + 1);

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <p className="mr-auto max-w-2xl text-sm text-zinc-500">
          Preparaciones que se hacen por lote (jarabe simple, sour mix, salsas). Los productos consumen una porción del lote
          y el sistema descuenta los insumos proporcionalmente.
        </p>
        <Button onClick={() => setEditing('new')} disabled={catalog.ingredients.length === 0}>
          <Plus className="size-4" /> Nueva sub-receta
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {catalog.subRecipes.map((s) => (
          <Card key={s.id}>
            <div className="flex items-start gap-3">
              <FlaskConical className="mt-0.5 size-5 text-brand-600" />
              <div className="min-w-0 flex-1">
                <h3 className="truncate font-semibold">{s.name}</h3>
                <p className="text-sm text-zinc-500">
                  Rinde {s.yield_quantity} {UNIT[s.yield_unit]} · {s.lines.length} insumo(s) · usada en {usage.get(s.id) ?? 0} producto(s)
                </p>
                <p className="tabular mt-2 text-sm">
                  Lote <b>{money(subRecipeBatchCost(s, ingredientMap))}</b> · {formatUnitCost(subRecipeUnitCost(s, ingredientMap), lookups.currency, lookups.locale)} / {UNIT[s.yield_unit]}
                </p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setEditing(s)} aria-label={`Editar ${s.name}`}>
                <Pencil className="size-4" />
              </Button>
            </div>
          </Card>
        ))}
        {catalog.subRecipes.length === 0 && (
          <Card className="py-10 text-center text-zinc-500 sm:col-span-2 xl:col-span-3">
            {catalog.ingredients.length === 0 ? 'Crea insumos en Inventario para armar sub-recetas.' : 'Aún no hay sub-recetas.'}
          </Card>
        )}
      </div>

      {editing && (
        <SubRecipeEditor
          key={editing === 'new' ? 'new' : editing.id}
          subRecipe={editing === 'new' ? null : editing}
          usedBy={editing === 'new' ? 0 : (usage.get(editing.id) ?? 0)}
          catalog={catalog}
          lookups={lookups}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

function SubRecipeEditor({
  subRecipe,
  usedBy,
  catalog,
  lookups,
  onClose,
}: {
  subRecipe: SubRecipe | null;
  usedBy: number;
  catalog: CatalogSnapshot;
  lookups: CatalogLookups;
  onClose: () => void;
}) {
  const { money, ingredientMap, subRecipeMap, currency, locale } = lookups;
  const { pending, flash, run } = useAdminMutation();
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState(subRecipe?.name ?? '');
  const [yieldQty, setYieldQty] = useState(subRecipe ? String(subRecipe.yield_quantity) : '1000');
  const [yieldUnit, setYieldUnit] = useState<MeasureUnit>(subRecipe?.yield_unit ?? 'ml');
  const [notes, setNotes] = useState(subRecipe?.notes ?? '');
  const [lines, setLines] = useState<DraftLine[]>(
    () => subRecipe?.lines.map((l) => ({ key: newLineKey(), ref: `i:${l.ingredient_id}`, quantity: String(l.quantity) })) ?? [],
  );

  const draft = {
    id: 'draft',
    yield_quantity: toNumber(yieldQty) > 0 ? toNumber(yieldQty) : 0,
    lines: lines
      .filter((l) => l.ref.startsWith('i:') && toNumber(l.quantity) > 0)
      .map((l) => ({ ingredient_id: l.ref.slice(2), quantity: toNumber(l.quantity) })),
  };

  const save = () => {
    setError(null);
    if (!name.trim()) return setError('El nombre es obligatorio');
    if (!(toNumber(yieldQty) > 0)) return setError('El rendimiento debe ser mayor a 0');
    const parsed = linesToRecipe(lines);
    if (!parsed.ok) return setError(parsed.error);
    run(
      () =>
        saveSubRecipeAction({
          id: subRecipe?.id ?? null,
          name,
          yield_quantity: toNumber(yieldQty),
          yield_unit: yieldUnit,
          notes: notes || null,
          lines: parsed.recipe.map((l) => ({ ingredient_id: l.ingredient_id!, quantity: l.quantity })),
        }),
      subRecipe ? 'Sub-receta actualizada' : 'Sub-receta creada',
      () => onClose(),
    );
  };

  return (
    <Sheet
      open
      onClose={onClose}
      title={subRecipe ? `Editar ${subRecipe.name}` : 'Nueva sub-receta'}
      className="sm:max-w-2xl"
      footer={
        <div className="space-y-2">
          {error && (
            <p role="alert" className="text-sm font-medium text-red-600">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            {subRecipe && (
              <Button
                variant="ghost"
                className="text-red-600"
                disabled={pending}
                onClick={() => {
                  if (usedBy > 0) return setError(`Está usada en ${usedBy} producto(s). Quítala de sus fichas técnicas primero.`);
                  if (confirm(`¿Eliminar "${subRecipe.name}"?`)) run(() => deleteEntityAction('sub_recipes', subRecipe.id), 'Sub-receta eliminada', () => onClose());
                }}
              >
                <Trash2 className="size-4" /> Eliminar
              </Button>
            )}
            <Button size="lg" className="flex-1" onClick={save} disabled={pending}>
              {pending ? 'Guardando…' : 'Guardar'}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-5">
        <section className="grid gap-3 sm:grid-cols-[1fr_8rem_7rem]">
          <div>
            <Label htmlFor="s-name">Nombre</Label>
            <Input id="s-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="s-yield">Rinde</Label>
            <Input id="s-yield" value={yieldQty} onChange={(e) => setYieldQty(e.target.value)} inputMode="decimal" />
          </div>
          <div>
            <Label htmlFor="s-unit">Unidad</Label>
            <Select id="s-unit" value={yieldUnit} onChange={(e) => setYieldUnit(e.target.value as MeasureUnit)}>
              <option value="ml">ml</option>
              <option value="g">g</option>
              <option value="unit">unidades</option>
            </Select>
          </div>
          <div className="sm:col-span-3">
            <Label htmlFor="s-notes">Notas / preparación</Label>
            <Input id="s-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Opcional" />
          </div>
        </section>
        <section>
          <h3 className="mb-2 font-semibold">Insumos del lote</h3>
          <RecipeEditor
            lines={lines}
            onChange={setLines}
            ingredients={catalog.ingredients}
            subRecipes={[]}
            ingredientMap={ingredientMap}
            subRecipeMap={subRecipeMap}
            currency={currency}
            locale={locale}
            allowSubRecipes={false}
          />
          <p className="tabular mt-3 rounded-2xl bg-zinc-100 p-3 text-sm dark:bg-zinc-800/60">
            Costo del lote <b>{money(subRecipeBatchCost(draft, ingredientMap))}</b> · costo por {UNIT[yieldUnit]}{' '}
            <b>{formatUnitCost(subRecipeUnitCost(draft, ingredientMap), currency, locale)}</b>
          </p>
        </section>
      </div>
      <FlashMessage flash={flash} />
    </Sheet>
  );
}
