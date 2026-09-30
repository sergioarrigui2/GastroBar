'use client';

import { ExternalLink, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { changeIngredientUnitAction, deleteEntityAction, getIngredientUsageAction, saveIngredientAction } from '@/app/actions/catalog';
import type { IngredientUsage } from '@/lib/services/catalog';
import { Button, Input, Label, Select } from '@/components/ui/primitives';
import { Sheet } from '@/components/ui/Sheet';
import type { MeasureUnit } from '@/types/database';
import type { Ingredient } from '@/types/domain';
import { formatQuantity } from '@/lib/utils';
import { FlashMessage, toNumber, useAdminMutation } from './useAdminMutation';

/** El costo se captura por kg / L / unidad (como se compra) y se guarda por g / ml / unidad. */
const PURCHASE_FACTOR: Record<MeasureUnit, number> = { g: 1000, ml: 1000, unit: 1 };
const PURCHASE_LABEL: Record<MeasureUnit, string> = { g: 'kg', ml: 'litro', unit: 'unidad' };

export function IngredientEditor({
  ingredient,
  currency,
  locale,
  onClose,
}: {
  ingredient: Ingredient | null;
  currency: string;
  locale: string;
  onClose: () => void;
}) {
  const { pending, flash, run } = useAdminMutation();
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState(ingredient?.name ?? '');
  const [unit, setUnit] = useState<MeasureUnit>(ingredient?.unit ?? 'ml');
  const [cost, setCost] = useState(ingredient ? String(+(ingredient.cost_per_unit * PURCHASE_FACTOR[ingredient.unit]).toFixed(2)) : '');
  const [minStock, setMinStock] = useState(ingredient ? String(ingredient.min_stock) : '0');
  const [initialStock, setInitialStock] = useState('0');
  const [isLiquor, setIsLiquor] = useState(ingredient?.is_liquor ?? false);
  const [usage, setUsage] = useState<IngredientUsage | null>(null);

  useEffect(() => {
    if (!ingredient) return;
    let alive = true;
    void getIngredientUsageAction(ingredient.id).then((r) => {
      if (alive && r.ok) setUsage(r.data);
    });
    return () => {
      alive = false;
    };
  }, [ingredient]);
  const usedIn = usage ? usage.products.length + usage.subRecipes.length : 0;

  const save = () => {
    setError(null);
    const costValue = toNumber(cost || '0');
    const min = toNumber(minStock || '0');
    const initial = toNumber(initialStock || '0');
    if (!name.trim()) return setError('El nombre es obligatorio');
    if (!(costValue >= 0) || !(min >= 0) || !(initial >= 0)) return setError('Los valores deben ser números positivos');
    run(
      () =>
        saveIngredientAction({
          id: ingredient?.id ?? null,
          name,
          unit,
          cost_per_unit: costValue / PURCHASE_FACTOR[unit],
          min_stock: min,
          is_liquor: isLiquor,
          initial_stock: ingredient ? undefined : initial,
        }),
      ingredient ? 'Insumo actualizado' : 'Insumo creado',
      onClose,
    );
  };

  return (
    <Sheet
      open
      onClose={onClose}
      title={ingredient ? `Editar ${ingredient.name}` : 'Nuevo insumo'}
      footer={
        <div className="space-y-2">
          {error && (
            <p role="alert" className="text-sm font-medium text-red-600">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            {ingredient && (
              <Button
                variant="ghost"
                className="text-red-600"
                disabled={pending || !usage || usedIn > 0}
                title={usedIn > 0 ? 'Quítalo primero de las recetas que lo usan' : undefined}
                onClick={() => confirm(`¿Eliminar "${ingredient.name}"?`) && run(() => deleteEntityAction('ingredients', ingredient.id), 'Insumo eliminado', onClose)}
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
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Label htmlFor="i-name">Nombre</Label>
          <Input id="i-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej. Ron blanco" />
        </div>
        <div>
          <Label htmlFor="i-unit">Unidad de receta</Label>
          <Select id="i-unit" value={unit} onChange={(e) => setUnit(e.target.value as MeasureUnit)} disabled={Boolean(ingredient)}>
            <option value="ml">Mililitros (ml)</option>
            <option value="g">Gramos (g)</option>
            <option value="unit">Unidades</option>
          </Select>
          {ingredient && <UnitChanger ingredient={ingredient} usedIn={usedIn} currency={currency} locale={locale} onDone={onClose} />}
        </div>
        <div>
          <Label htmlFor="i-cost">
            Costo por {PURCHASE_LABEL[unit]} ({currency})
          </Label>
          <Input id="i-cost" value={cost} onChange={(e) => setCost(e.target.value)} inputMode="decimal" placeholder="0" />
          <p className="mt-1 text-xs text-zinc-500">
            = {((toNumber(cost || '0') || 0) / PURCHASE_FACTOR[unit]).toLocaleString(locale, { maximumFractionDigits: 4 })} {currency} por{' '}
            {unit === 'unit' ? 'unidad' : unit}
          </p>
        </div>
        <div>
          <Label htmlFor="i-min">Stock mínimo ({unit === 'unit' ? 'u' : unit})</Label>
          <Input id="i-min" value={minStock} onChange={(e) => setMinStock(e.target.value)} inputMode="decimal" />
        </div>
        {!ingredient ? (
          <div>
            <Label htmlFor="i-initial">Stock inicial ({unit === 'unit' ? 'u' : unit})</Label>
            <Input id="i-initial" value={initialStock} onChange={(e) => setInitialStock(e.target.value)} inputMode="decimal" />
          </div>
        ) : (
          <p className="self-end pb-2 text-xs text-zinc-500">El stock se ajusta con compras, mermas o ajustes (panel derecho).</p>
        )}
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" className="size-5 accent-emerald-600" checked={isLiquor} onChange={(e) => setIsLiquor(e.target.checked)} />
          Es licor (aparece en el filtro "Licores")
        </label>
      </div>
      {ingredient && (
        <section className="mt-5 border-t border-zinc-200 pt-4 dark:border-zinc-800" aria-labelledby="i-usage">
          <h3 id="i-usage" className="text-sm font-semibold">
            {!usage ? 'Buscando dónde se usa…' : usedIn === 0 ? 'No está en ninguna receta' : `Se usa en ${usedIn} receta${usedIn === 1 ? '' : 's'}`}
          </h3>
          {usage && usedIn === 0 && <p className="mt-1 text-xs text-zinc-500">Puedes eliminarlo sin afectar el menú.</p>}
          {usedIn > 0 && (
            <>
              <p className="mt-1 text-xs text-zinc-500">
                Para eliminarlo, ábrelas y quítalo (o cámbialo por otro insumo). Si ya no lo compras pero sigue en recetas, no lo borres: el
                historial y los costos dependen de él.
              </p>
              <ul className="mt-2 flex flex-wrap gap-2">
                {usage!.products.map((p) => (
                  <li key={p.id}>
                    <Link
                      href={`/admin/menu?open=${p.id}`}
                      className="inline-flex items-center gap-1 rounded-lg bg-zinc-100 px-2.5 py-1 text-sm hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700"
                    >
                      {p.name}
                      {!p.is_active && <span className="text-xs text-zinc-500">(inactivo)</span>}
                      <ExternalLink className="size-3 text-zinc-400" />
                    </Link>
                  </li>
                ))}
                {usage!.subRecipes.map((sr) => (
                  <li key={sr.id}>
                    <Link
                      href={`/admin/menu?tab=sub-recipes&open=${sr.id}`}
                      className="inline-flex items-center gap-1 rounded-lg bg-sky-100 px-2.5 py-1 text-sm text-sky-900 hover:bg-sky-200 dark:bg-sky-500/15 dark:text-sky-100"
                    >
                      {sr.name} <span className="text-xs opacity-70">sub-receta</span>
                      <ExternalLink className="size-3 opacity-60" />
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}
      <FlashMessage flash={flash} />
    </Sheet>
  );
}

const UNIT_NAME: Record<MeasureUnit, string> = { g: 'gramos', ml: 'mililitros', unit: 'unidades' };
const UNIT_SHORT: Record<MeasureUnit, string> = { g: 'g', ml: 'ml', unit: 'u' };

/**
 * Cambio de unidad con conversión: se pide cuánto trae 1 unidad (botella, paquete) y
 * se convierten stock, mínimo, costo, empaque, recetas e historial en un solo paso.
 */
function UnitChanger({
  ingredient,
  usedIn,
  currency,
  locale,
  onDone,
}: {
  ingredient: Ingredient;
  usedIn: number;
  currency: string;
  locale: string;
  onDone: () => void;
}) {
  const { pending, flash, run } = useAdminMutation();
  const [open, setOpen] = useState(false);
  const from = ingredient.unit;
  const options = (['unit', 'ml', 'g'] as MeasureUnit[]).filter((u) => u !== from);
  const [to, setTo] = useState<MeasureUnit>(options[0]!);
  const [amount, setAmount] = useState(from === 'unit' || to === 'unit' ? '' : '1');

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="mt-1 text-xs font-semibold text-brand-600 hover:underline">
        ¿Se creó con la unidad equivocada? Cambiar unidad
      </button>
    );
  }

  const measure = from === 'unit' ? to : from; // g o ml (o el mismo par g↔ml)
  const value = toNumber(amount || '0');
  // factor = cuántas unidades actuales trae 1 unidad nueva
  const factor = !(value > 0) ? 0 : to === 'unit' ? value : from === 'unit' ? 1 / value : value;
  const question =
    to === 'unit'
      ? `¿Cuántos ${UNIT_SHORT[from]} trae 1 unidad (botella, paquete…)?`
      : from === 'unit'
        ? `¿Cuántos ${UNIT_SHORT[to]} trae 1 unidad actual?`
        : `1 ${UNIT_SHORT[to]} equivale a cuántos ${UNIT_SHORT[from]}`;
  const q = (n: number) => `${(Math.round(n * 1000) / 1000).toLocaleString(locale)} ${UNIT_SHORT[to]}`;
  const money = (n: number) => n.toLocaleString(locale, { style: 'currency', currency, maximumFractionDigits: 2 });

  return (
    <div className="mt-2 space-y-2 rounded-xl border border-brand-500/40 bg-brand-50 p-3 text-sm dark:bg-brand-500/10">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label htmlFor="u-to">Nueva unidad</Label>
          <Select id="u-to" value={to} onChange={(e) => setTo(e.target.value as MeasureUnit)}>
            {options.map((u) => (
              <option key={u} value={u}>
                {UNIT_NAME[u]}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="u-factor">{question}</Label>
          <Input id="u-factor" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder={measure === 'ml' ? '750' : '1000'} />
        </div>
      </div>
      {factor > 0 && (
        <ul className="space-y-0.5 text-xs text-zinc-600 dark:text-zinc-300">
          <li>Stock: {formatQuantity(ingredient.stock_quantity, from)} → {q(ingredient.stock_quantity / factor)}</li>
          <li>Mínimo: {formatQuantity(ingredient.min_stock, from)} → {q(ingredient.min_stock / factor)}</li>
          <li>
            Costo: {money(ingredient.cost_per_unit)} por {UNIT_SHORT[from]} → {money(ingredient.cost_per_unit * factor)} por {UNIT_SHORT[to]}
          </li>
          <li>
            {usedIn > 0
              ? `Se convierten las ${usedIn} receta(s) que lo usan (ej. 60 ${UNIT_SHORT[from]} → ${q(60 / factor)}).`
              : 'No está en recetas.'}{' '}
            El historial también se convierte.
          </li>
        </ul>
      )}
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={pending || !(factor > 0)}
          onClick={() =>
            confirm(`¿Convertir "${ingredient.name}" de ${UNIT_NAME[from]} a ${UNIT_NAME[to]}?`) &&
            run(() => changeIngredientUnitAction({ ingredientId: ingredient.id, unit: to, factor }), 'Unidad cambiada', onDone)
          }
        >
          Convertir
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancelar
        </Button>
      </div>
      <FlashMessage flash={flash} />
    </div>
  );
}
