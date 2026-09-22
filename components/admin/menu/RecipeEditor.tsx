'use client';

import { Plus, Trash2 } from 'lucide-react';
import { Input, Select } from '@/components/ui/primitives';
import { recipeLineCost, type CostIngredient, type CostSubRecipe } from '@/lib/catalog/costing';
import { formatCurrency } from '@/lib/utils';
import type { MeasureUnit } from '@/types/database';
import { toNumber } from '../useAdminMutation';

export type DraftLine = { key: string; ref: string; quantity: string };

/** ref codificado: "i:<uuid>" para insumo, "s:<uuid>" para sub-receta. */
export const refOf = (line: { ingredient_id?: string | null; sub_recipe_id?: string | null }) =>
  line.ingredient_id ? `i:${line.ingredient_id}` : line.sub_recipe_id ? `s:${line.sub_recipe_id}` : '';

export function parseRef(ref: string): { ingredient_id: string | null; sub_recipe_id: string | null } {
  if (ref.startsWith('i:')) return { ingredient_id: ref.slice(2), sub_recipe_id: null };
  if (ref.startsWith('s:')) return { ingredient_id: null, sub_recipe_id: ref.slice(2) };
  return { ingredient_id: null, sub_recipe_id: null };
}

let keySeq = 0;
export const newLineKey = () => `line-${Date.now()}-${keySeq++}`;

const UNIT_LABEL: Record<MeasureUnit, string> = { g: 'g', ml: 'ml', unit: 'u' };

export function RecipeEditor({
  lines,
  onChange,
  ingredients,
  subRecipes,
  ingredientMap,
  subRecipeMap,
  currency,
  locale,
  allowSubRecipes = true,
}: {
  lines: DraftLine[];
  onChange: (lines: DraftLine[]) => void;
  ingredients: Array<{ id: string; name: string; unit: MeasureUnit }>;
  subRecipes: Array<{ id: string; name: string; yield_unit: MeasureUnit }>;
  ingredientMap: Map<string, CostIngredient>;
  subRecipeMap: Map<string, CostSubRecipe>;
  currency: string;
  locale: string;
  allowSubRecipes?: boolean;
}) {
  const money = (n: number) => formatCurrency(n, currency, locale);
  const unitOf = (ref: string): string => {
    const { ingredient_id, sub_recipe_id } = parseRef(ref);
    if (ingredient_id) return UNIT_LABEL[ingredients.find((i) => i.id === ingredient_id)?.unit ?? 'unit'];
    if (sub_recipe_id) return UNIT_LABEL[subRecipes.find((s) => s.id === sub_recipe_id)?.yield_unit ?? 'unit'];
    return '';
  };
  const update = (key: string, patch: Partial<DraftLine>) =>
    onChange(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  return (
    <div className="space-y-2">
      {lines.length === 0 && (
        <p className="rounded-xl border border-dashed border-zinc-300 p-3 text-sm text-zinc-500 dark:border-zinc-700">
          Sin insumos: se venderá sin descontar stock.
        </p>
      )}
      {lines.map((line) => {
        const qty = toNumber(line.quantity);
        const cost = line.ref && qty > 0 ? recipeLineCost({ ...parseRef(line.ref), quantity: qty }, ingredientMap, subRecipeMap) : 0;
        return (
          <div key={line.key} className="grid grid-cols-[1fr_6.5rem_auto] items-center gap-2 sm:grid-cols-[1fr_7rem_6rem_auto]">
            <Select value={line.ref} onChange={(e) => update(line.key, { ref: e.target.value })} aria-label="Insumo">
              <option value="" disabled>
                Elegir…
              </option>
              <optgroup label="Insumos">
                {ingredients.map((i) => (
                  <option key={i.id} value={`i:${i.id}`}>
                    {i.name}
                  </option>
                ))}
              </optgroup>
              {allowSubRecipes && subRecipes.length > 0 && (
                <optgroup label="Sub-recetas">
                  {subRecipes.map((s) => (
                    <option key={s.id} value={`s:${s.id}`}>
                      {s.name}
                    </option>
                  ))}
                </optgroup>
              )}
            </Select>
            <label className="relative">
              <Input
                inputMode="decimal"
                value={line.quantity}
                onChange={(e) => update(line.key, { quantity: e.target.value })}
                aria-label="Cantidad"
                className="pr-8 text-right"
              />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-zinc-500">
                {unitOf(line.ref)}
              </span>
            </label>
            <span className="tabular hidden text-right text-sm text-zinc-500 sm:block">{money(cost)}</span>
            <button
              type="button"
              onClick={() => onChange(lines.filter((l) => l.key !== line.key))}
              aria-label="Quitar línea"
              className="grid size-11 place-items-center rounded-xl text-zinc-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10"
            >
              <Trash2 className="size-4" />
            </button>
          </div>
        );
      })}
      <button
        type="button"
        onClick={() => onChange([...lines, { key: newLineKey(), ref: '', quantity: '' }])}
        className="flex h-10 items-center gap-1 rounded-xl px-3 text-sm font-semibold text-brand-700 hover:bg-brand-50 dark:text-brand-400 dark:hover:bg-brand-500/10"
      >
        <Plus className="size-4" /> Agregar insumo
      </button>
    </div>
  );
}

/** Valida y convierte las líneas del editor; devuelve error legible si algo falta. */
export function linesToRecipe(lines: DraftLine[]):
  | { ok: true; recipe: Array<{ ingredient_id: string | null; sub_recipe_id: string | null; quantity: number }> }
  | { ok: false; error: string } {
  const recipe = [];
  const seen = new Set<string>();
  for (const [index, line] of lines.entries()) {
    if (!line.ref) return { ok: false, error: `Línea ${index + 1}: elige un insumo` };
    const quantity = toNumber(line.quantity);
    if (!(quantity > 0)) return { ok: false, error: `Línea ${index + 1}: la cantidad debe ser mayor a 0` };
    if (seen.has(line.ref)) return { ok: false, error: `Línea ${index + 1}: insumo repetido` };
    seen.add(line.ref);
    recipe.push({ ...parseRef(line.ref), quantity });
  }
  return { ok: true, recipe };
}
