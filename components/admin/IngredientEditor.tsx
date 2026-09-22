'use client';

import { Trash2 } from 'lucide-react';
import { useState } from 'react';
import { deleteEntityAction, saveIngredientAction } from '@/app/actions/catalog';
import { Button, Input, Label, Select } from '@/components/ui/primitives';
import { Sheet } from '@/components/ui/Sheet';
import type { MeasureUnit } from '@/types/database';
import type { Ingredient } from '@/types/domain';
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
                disabled={pending}
                onClick={() => confirm(`¿Eliminar "${ingredient.name}"? Si está en alguna receta no se podrá.`) && run(() => deleteEntityAction('ingredients', ingredient.id), 'Insumo eliminado', onClose)}
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
          {ingredient && <p className="mt-1 text-xs text-zinc-500">La unidad no se cambia para no alterar recetas ni stock.</p>}
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
      <FlashMessage flash={flash} />
    </Sheet>
  );
}
