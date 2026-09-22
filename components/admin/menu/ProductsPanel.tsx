'use client';

import { ChefHat, Martini, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  deleteEntityAction,
  saveModifierAction,
  saveProductAction,
  setProductActiveAction,
  setProductImageAction,
} from '@/app/actions/catalog';
import { Badge, Button, Card, Input, Label, Select } from '@/components/ui/primitives';
import { Sheet } from '@/components/ui/Sheet';
import { costProduct, foodCostLevel, netOfTax } from '@/lib/catalog/costing';
import type { CatalogSnapshot } from '@/lib/services/catalog';
import { cn } from '@/lib/utils';
import type { Tables } from '@/types/database';
import { FlashMessage, toNumber, useAdminMutation } from '../useAdminMutation';
import type { CatalogLookups } from './MenuManager';
import { ProductImageField } from './ProductImageField';
import { linesToRecipe, newLineKey, RecipeEditor, refOf, type DraftLine } from './RecipeEditor';

type Product = Tables<'products'>;

const LEVEL_STYLES = {
  good: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200',
  watch: 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200',
  high: 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300',
  none: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400',
} as const;

/** Food cost objetivo para sugerir precio. */
const TARGET_FOOD_COST = 25;

export function ProductsPanel({ catalog, lookups }: { catalog: CatalogSnapshot; lookups: CatalogLookups }) {
  const { money, ingredientMap, subRecipeMap } = lookups;
  const { pending, flash, run } = useAdminMutation();
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [editing, setEditing] = useState<Product | 'new' | null>(null);

  const categories = useMemo(() => new Map(catalog.categories.map((c) => [c.id, c])), [catalog.categories]);
  const recipesByProduct = useMemo(() => {
    const map = new Map<string, Tables<'recipes'>[]>();
    for (const r of catalog.recipes) map.set(r.product_id, [...(map.get(r.product_id) ?? []), r]);
    return map;
  }, [catalog.recipes]);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return catalog.products
      .filter((p) => (categoryFilter === 'all' || p.category_id === categoryFilter) && (!term || p.name.toLowerCase().includes(term)))
      .map((p) => ({
        product: p,
        costing: costProduct(
          netOfTax(p.price, p.tax_rate ?? lookups.tax.rate, lookups.tax.included),
          recipesByProduct.get(p.id) ?? [],
          ingredientMap,
          subRecipeMap,
        ),
        lines: recipesByProduct.get(p.id)?.length ?? 0,
      }));
  }, [catalog.products, categoryFilter, search, recipesByProduct, ingredientMap, subRecipeMap, lookups.tax]);

  if (catalog.categories.length === 0) {
    return (
      <Card className="py-10 text-center text-zinc-500">
        Primero crea al menos una categoría en la pestaña <b>Categorías</b>.
      </Card>
    );
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-48 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-400" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar producto…" aria-label="Buscar producto" className="pl-9" type="search" />
        </label>
        <Select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className="w-auto min-w-40" aria-label="Filtrar por categoría">
          <option value="all">Todas las categorías</option>
          {catalog.categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        <Button onClick={() => setEditing('new')}>
          <Plus className="size-4" /> Nuevo producto
        </Button>
      </div>

      <Card className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-4 py-3 font-medium">Producto</th>
                <th className="px-4 py-3 text-right font-medium">Precio</th>
                <th className="px-4 py-3 text-right font-medium">Costo</th>
                <th className="px-4 py-3 text-right font-medium">Food cost</th>
                <th className="px-4 py-3 text-center font-medium">Activo</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="tabular divide-y divide-zinc-100 dark:divide-zinc-800">
              {rows.map(({ product: p, costing, lines }) => {
                const category = categories.get(p.category_id);
                const level = lines > 0 ? foodCostLevel(costing.foodCostPct) : 'none';
                return (
                  <tr key={p.id} className={cn(!p.is_active && 'opacity-50')}>
                    <td className="px-4 py-3">
                      <button onClick={() => setEditing(p)} className="flex items-center gap-3 text-left">
                        {p.image_url ? (
                          <img src={p.image_url} alt="" className="size-10 shrink-0 rounded-lg object-cover" />
                        ) : (
                          <span className="size-10 shrink-0 rounded-lg bg-zinc-100 dark:bg-zinc-800" />
                        )}
                        <span>
                        <span className="block font-semibold hover:underline">{p.name}</span>
                        <span className="flex items-center gap-1 text-xs text-zinc-500">
                          {category?.station === 'bar' ? <Martini className="size-3" /> : <ChefHat className="size-3" />}
                          {category?.name} · {lines > 0 ? `${lines} insumo(s)` : 'sin receta'}
                          {!p.track_stock && ' · sin control de stock'}
                        </span>
                        </span>
                      </button>
                    </td>
                    <td className="px-4 py-3 text-right font-semibold">{money(p.price)}</td>
                    <td className="px-4 py-3 text-right text-zinc-500">{lines > 0 ? money(costing.cost) : '—'}</td>
                    <td className="px-4 py-3 text-right">
                      <Badge className={LEVEL_STYLES[level]}>
                        {level === 'none' ? '—' : `${costing.foodCostPct!.toFixed(1)}%`}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <input
                        type="checkbox"
                        className="size-5 accent-emerald-600"
                        checked={p.is_active}
                        disabled={pending}
                        aria-label={`${p.name} activo`}
                        onChange={(e) =>
                          run(() => setProductActiveAction(p.id, e.target.checked), e.target.checked ? `${p.name} activado` : `${p.name} oculto del menú`)
                        }
                      />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button variant="ghost" size="sm" onClick={() => setEditing(p)} aria-label={`Editar ${p.name}`}>
                        <Pencil className="size-4" />
                      </Button>
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-zinc-500">
                    No hay productos para este filtro.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {editing && (
        <ProductEditor
          key={editing === 'new' ? 'new' : editing.id}
          product={editing === 'new' ? null : editing}
          defaultCategoryId={categoryFilter !== 'all' ? categoryFilter : catalog.categories[0]!.id}
          catalog={catalog}
          lookups={lookups}
          onClose={() => setEditing(null)}
        />
      )}
      <FlashMessage flash={flash} />
    </>
  );
}

function ProductEditor({
  product,
  defaultCategoryId,
  catalog,
  lookups,
  onClose,
}: {
  product: Product | null;
  defaultCategoryId: string;
  catalog: CatalogSnapshot;
  lookups: CatalogLookups;
  onClose: () => void;
}) {
  const { money, ingredientMap, subRecipeMap, currency, locale } = lookups;
  const { pending, flash, run } = useAdminMutation();
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState(product?.name ?? '');
  const [categoryId, setCategoryId] = useState(product?.category_id ?? defaultCategoryId);
  const [price, setPrice] = useState(product ? String(product.price) : '');
  const [description, setDescription] = useState(product?.description ?? '');
  const [sortOrder, setSortOrder] = useState(String(product?.sort_order ?? 0));
  const [isActive, setIsActive] = useState(product?.is_active ?? true);
  const [trackStock, setTrackStock] = useState(product?.track_stock ?? true);
  const [imageUrl, setImageUrl] = useState<string | null>(product?.image_url ?? null);
  const [taxChoice, setTaxChoice] = useState<string>(product?.tax_rate == null ? 'default' : String(product.tax_rate));
  const effectiveTax = taxChoice === 'default' ? lookups.tax.rate : Number(taxChoice);
  const [lines, setLines] = useState<DraftLine[]>(() =>
    catalog.recipes
      .filter((r) => r.product_id === product?.id)
      .map((r) => ({ key: newLineKey(), ref: refOf(r), quantity: String(r.quantity) })),
  );

  const priceValue = toNumber(price);
  const validLines = lines
    .filter((l) => l.ref && toNumber(l.quantity) > 0)
    .map((l) => ({
      ingredient_id: l.ref.startsWith('i:') ? l.ref.slice(2) : null,
      sub_recipe_id: l.ref.startsWith('s:') ? l.ref.slice(2) : null,
      quantity: toNumber(l.quantity),
    }));
  const netPrice = netOfTax(priceValue > 0 ? priceValue : 0, effectiveTax, lookups.tax.included);
  const costing = costProduct(netPrice, validLines, ingredientMap, subRecipeMap);
  const level = validLines.length > 0 ? foodCostLevel(costing.foodCostPct) : 'none';
  const suggestedNet = costing.cost > 0 ? costing.cost / (TARGET_FOOD_COST / 100) : null;
  const suggestedPrice = suggestedNet && lookups.tax.included ? suggestedNet * (1 + effectiveTax / 100) : suggestedNet;

  const productModifiers = catalog.modifiers.filter((m) => product && m.product_id === product.id);
  const [newModName, setNewModName] = useState('');
  const [newModPrice, setNewModPrice] = useState('0');

  const save = () => {
    setError(null);
    if (!name.trim()) return setError('El nombre es obligatorio');
    if (!(priceValue >= 0) || price.trim() === '') return setError('Precio inválido');
    const parsed = linesToRecipe(lines);
    if (!parsed.ok) return setError(parsed.error);
    run(
      async () => {
        const saved = await saveProductAction({
          id: product?.id ?? null,
          category_id: categoryId,
          name,
          description: description || null,
          price: priceValue,
          sort_order: Math.max(0, Math.trunc(toNumber(sortOrder) || 0)),
          is_active: isActive,
          track_stock: trackStock,
          recipe: parsed.recipe,
          tax_rate: taxChoice === 'default' ? null : Number(taxChoice),
        });
        if (!saved.ok || imageUrl === (product?.image_url ?? null)) return saved;
        const withImage = await setProductImageAction(saved.data, imageUrl);
        return withImage.ok ? saved : { ok: false as const, error: withImage.error };
      },
      product ? 'Producto actualizado' : 'Producto creado',
      () => onClose(),
    );
  };

  const remove = () => {
    if (!product || !confirm(`¿Eliminar "${product.name}"? Si ya tiene ventas, desactívalo en su lugar.`)) return;
    run(() => deleteEntityAction('products', product.id), 'Producto eliminado', () => onClose());
  };

  const addModifier = () => {
    if (!product || !newModName.trim()) return;
    run(
      () => saveModifierAction({ product_id: product.id, name: newModName, price_delta: toNumber(newModPrice) || 0, sort_order: productModifiers.length + 1 }),
      'Modificador agregado',
      () => {
        setNewModName('');
        setNewModPrice('0');
      },
    );
  };

  return (
    <Sheet
      open
      onClose={onClose}
      title={product ? `Editar ${product.name}` : 'Nuevo producto'}
      className="sm:max-w-2xl"
      footer={
        <div className="space-y-2">
          {error && (
            <p role="alert" className="text-sm font-medium text-red-600">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            {product && (
              <Button variant="ghost" className="text-red-600" onClick={remove} disabled={pending}>
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
        <section className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <ProductImageField tenantId={lookups.tenantId} value={imageUrl} onChange={setImageUrl} />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="p-name">Nombre</Label>
            <Input id="p-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus={!product} />
          </div>
          <div>
            <Label htmlFor="p-category">Categoría</Label>
            <Select id="p-category" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              {catalog.categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.station === 'bar' ? 'Barra' : 'Cocina'})
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="p-price">Precio de venta ({currency})</Label>
            <Input id="p-price" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0" />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="p-desc">Descripción</Label>
            <Input id="p-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Opcional, visible para meseros" />
          </div>
          <div>
            <Label htmlFor="p-sort">Orden en el menú</Label>
            <Input id="p-sort" inputMode="numeric" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
          </div>
          <div className="flex flex-col justify-end gap-2 pb-1">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="size-5 accent-emerald-600" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
              Visible en el menú
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="size-5 accent-emerald-600" checked={trackStock} onChange={(e) => setTrackStock(e.target.checked)} />
              Descontar stock según receta
            </label>
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="p-tax">Impuesto</Label>
            <Select id="p-tax" value={taxChoice} onChange={(e) => setTaxChoice(e.target.value)}>
              <option value="default">
                Por defecto del gastrobar ({lookups.tax.name} {lookups.tax.rate}%)
              </option>
              <option value="0">Exento (0%)</option>
              <option value="5">IVA 5%</option>
              <option value="8">INC 8%</option>
              <option value="19">IVA 19%</option>
            </Select>
            <p className="mt-1 text-xs text-zinc-500">
              {lookups.tax.included
                ? `El precio incluye el impuesto: base ${money(netPrice)} + impuesto ${money(Math.max(0, priceValue - netPrice))}.`
                : `El impuesto se suma al precio al cobrar (${effectiveTax}%).`}
            </p>
          </div>
        </section>

        <section>
          <h3 className="mb-2 font-semibold">Ficha técnica (por porción)</h3>
          <RecipeEditor
            lines={lines}
            onChange={setLines}
            ingredients={catalog.ingredients}
            subRecipes={catalog.subRecipes}
            ingredientMap={ingredientMap}
            subRecipeMap={subRecipeMap}
            currency={currency}
            locale={locale}
          />
          <dl className="tabular mt-3 grid grid-cols-2 gap-2 rounded-2xl bg-zinc-100 p-3 text-sm sm:grid-cols-4 dark:bg-zinc-800/60">
            <div>
              <dt className="text-xs text-zinc-500">Costo porción</dt>
              <dd className="font-bold">{money(costing.cost)}</dd>
            </div>
            <div>
              <dt className="text-xs text-zinc-500">Food cost (sin impuesto)</dt>
              <dd>
                <Badge className={LEVEL_STYLES[level]}>{costing.foodCostPct === null || level === 'none' ? '—' : `${costing.foodCostPct.toFixed(1)}%`}</Badge>
              </dd>
            </div>
            <div>
              <dt className="text-xs text-zinc-500">Margen bruto</dt>
              <dd className="font-bold">{costing.marginPct === null ? '—' : `${money(netPrice - costing.cost)} (${costing.marginPct.toFixed(0)}%)`}</dd>
            </div>
            <div>
              <dt className="text-xs text-zinc-500">Precio sugerido ({TARGET_FOOD_COST}%)</dt>
              <dd className="font-bold">{suggestedPrice ? money(Math.ceil(suggestedPrice / 100) * 100) : '—'}</dd>
            </div>
          </dl>
        </section>

        <section>
          <h3 className="mb-2 font-semibold">Modificadores de este producto</h3>
          {!product ? (
            <p className="text-sm text-zinc-500">Guarda el producto para agregarle modificadores. Los de su categoría aplican automáticamente.</p>
          ) : (
            <div className="space-y-2">
              {productModifiers.map((m) => (
                <div key={m.id} className="flex items-center gap-2 rounded-xl border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-800">
                  <span className="flex-1 font-medium">{m.name}</span>
                  <span className="tabular text-zinc-500">{m.price_delta !== 0 ? `${m.price_delta > 0 ? '+' : ''}${money(m.price_delta)}` : 'sin costo'}</span>
                  <button
                    type="button"
                    aria-label={`Eliminar ${m.name}`}
                    onClick={() => run(() => deleteEntityAction('modifiers', m.id), 'Modificador eliminado')}
                    className="grid size-8 place-items-center rounded-lg text-zinc-400 hover:text-red-600"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              ))}
              <div className="grid grid-cols-[1fr_7rem_auto] gap-2">
                <Input value={newModName} onChange={(e) => setNewModName(e.target.value)} placeholder='Ej. "Término medio"' aria-label="Nombre del modificador" />
                <Input value={newModPrice} onChange={(e) => setNewModPrice(e.target.value)} inputMode="decimal" aria-label="Costo extra" />
                <Button variant="secondary" onClick={addModifier} disabled={pending || !newModName.trim()}>
                  <Plus className="size-4" />
                </Button>
              </div>
            </div>
          )}
        </section>
      </div>
      <FlashMessage flash={flash} />
    </Sheet>
  );
}
