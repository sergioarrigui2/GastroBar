'use client';

import { useMemo, useState } from 'react';
import type { CostIngredient, CostSubRecipe } from '@/lib/catalog/costing';
import type { CatalogSnapshot } from '@/lib/services/catalog';
import { cn, formatCurrency } from '@/lib/utils';
import { CategoriesPanel } from './CategoriesPanel';
import { ModifiersPanel } from './ModifiersPanel';
import type { MenuInsight } from '@/lib/services/agent-notices';
import { ProductsPanel } from './ProductsPanel';
import { ImagesPanel } from './ImagesPanel';
import { SubRecipesPanel } from './SubRecipesPanel';

type Tab = 'products' | 'categories' | 'modifiers' | 'sub-recipes' | 'images';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'products', label: 'Productos' },
  { id: 'categories', label: 'Categorías' },
  { id: 'modifiers', label: 'Modificadores' },
  { id: 'sub-recipes', label: 'Sub-recetas' },
  { id: 'images', label: 'Imágenes' },
];

export type CatalogLookups = {
  tenantId: string;
  tax: { name: string; rate: number; included: boolean };
  ingredientMap: Map<string, CostIngredient>;
  subRecipeMap: Map<string, CostSubRecipe>;
  money: (n: number) => string;
  currency: string;
  locale: string;
};

export function MenuManager({
  tenantId,
  tax,
  catalog,
  currency,
  locale,
  initialTab,
  insights,
  openId,
}: {
  tenantId: string;
  tax: CatalogLookups['tax'];
  catalog: CatalogSnapshot;
  currency: string;
  locale: string;
  initialTab: Tab;
  insights?: Record<string, MenuInsight>;
  /** Abre directamente el editor de ese producto o sub-receta (enlaces desde Inventario). */
  openId?: string;
}) {
  const [tab, setTab] = useState<Tab>(
    openId && catalog.subRecipes.some((s) => s.id === openId) ? 'sub-recipes' : initialTab,
  );

  const lookups = useMemo<CatalogLookups>(
    () => ({
      tenantId,
      tax,
      ingredientMap: new Map(catalog.ingredients.map((i) => [i.id, i])),
      subRecipeMap: new Map(catalog.subRecipes.map((s) => [s.id, s])),
      money: (n: number) => formatCurrency(n, currency, locale),
      currency,
      locale,
    }),
    [tenantId, tax, catalog.ingredients, catalog.subRecipes, currency, locale],
  );

  const selectTab = (next: Tab) => {
    setTab(next);
    const url = new URL(window.location.href);
    if (next === 'products') url.searchParams.delete('tab');
    else url.searchParams.set('tab', next);
    window.history.replaceState(null, '', url);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="mr-auto text-2xl font-bold">Menú</h1>
        <nav role="tablist" aria-label="Secciones del menú" className="scrollbar-none flex gap-1 overflow-x-auto rounded-xl bg-zinc-100 p-1 dark:bg-zinc-900">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => selectTab(t.id)}
              className={cn(
                'shrink-0 rounded-lg px-3 py-1.5 text-sm font-semibold',
                tab === t.id ? 'bg-white shadow dark:bg-zinc-800' : 'text-zinc-500',
              )}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </div>

      {tab === 'products' && <ProductsPanel catalog={catalog} lookups={lookups} insights={insights} openId={openId} />}
      {tab === 'categories' && <CategoriesPanel catalog={catalog} />}
      {tab === 'modifiers' && <ModifiersPanel catalog={catalog} lookups={lookups} />}
      {tab === 'images' && <ImagesPanel catalog={catalog} tenantId={tenantId} />}
      {tab === 'sub-recipes' && <SubRecipesPanel catalog={catalog} lookups={lookups} openId={openId} />}
    </div>
  );
}
