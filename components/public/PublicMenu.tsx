'use client';

import { ChefHat, MapPin, Martini, Phone, Search } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { Suspense, useMemo, useState } from 'react';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { cn, formatCurrency } from '@/lib/utils';

export type PublicMenuData = {
  tenant: { name: string; slug: string; currency: string; locale: string; address: string | null; phone: string | null };
  categories: Array<{ id: string; name: string; station: 'bar' | 'kitchen' }>;
  products: Array<{
    id: string;
    category_id: string;
    name: string;
    description: string | null;
    price: number;
    image_url: string | null;
    available: boolean;
  }>;
  modifiers: Array<{ product_id: string | null; category_id: string | null; name: string; price_delta: number }>;
};

/** El número de mesa llega en el QR (?mesa=T4); sólo se muestra, no se usa para nada más. */
function TableBadge() {
  const mesa = useSearchParams().get('mesa')?.replace(/[^\w -]/g, '').slice(0, 12);
  if (!mesa) return null;
  return <span className="rounded-full bg-brand-500 px-3 py-1 text-sm font-bold text-zinc-950">Mesa {mesa}</span>;
}

export function PublicMenu({ menu }: { menu: PublicMenuData }) {
  const { tenant } = menu;
  const money = (n: number) => formatCurrency(n, tenant.currency, tenant.locale);
  const [search, setSearch] = useState('');

  const sections = useMemo(() => {
    const term = search.trim().toLowerCase();
    return menu.categories
      .map((c) => ({
        category: c,
        products: menu.products.filter(
          (p) =>
            p.category_id === c.id &&
            (!term || p.name.toLowerCase().includes(term) || (p.description ?? '').toLowerCase().includes(term)),
        ),
      }))
      .filter((s) => s.products.length > 0);
  }, [menu, search]);

  const extrasFor = (p: PublicMenuData['products'][number]) =>
    menu.modifiers.filter(
      (m) => m.product_id === p.id || m.category_id === p.category_id || (m.product_id === null && m.category_id === null),
    );

  return (
    <div className="mx-auto min-h-dvh max-w-2xl pb-16">
      <header className="px-4 pb-4 pt-6">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="text-3xl font-black tracking-tight">{tenant.name}</h1>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-zinc-500">
              {tenant.address && (
                <span className="flex items-center gap-1">
                  <MapPin className="size-4" /> {tenant.address}
                </span>
              )}
              {tenant.phone && (
                <a href={`tel:${tenant.phone}`} className="flex items-center gap-1 hover:underline">
                  <Phone className="size-4" /> {tenant.phone}
                </a>
              )}
            </div>
          </div>
          <ThemeToggle />
        </div>
        <div className="mt-3">
          <Suspense>
            <TableBadge />
          </Suspense>
        </div>
      </header>

      <div className="sticky top-0 z-10 space-y-2 border-b border-zinc-200 bg-zinc-50/95 px-4 py-3 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/95">
        <label className="relative block">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-5 -translate-y-1/2 text-zinc-400" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar en la carta…"
            aria-label="Buscar en la carta"
            className="h-11 w-full rounded-2xl border border-zinc-200 bg-white pl-10 pr-3 text-base dark:border-zinc-800 dark:bg-zinc-900"
          />
        </label>
        <nav aria-label="Secciones" className="scrollbar-none -mx-4 flex gap-2 overflow-x-auto px-4">
          {sections.map(({ category }) => (
            <a
              key={category.id}
              href={`#cat-${category.id}`}
              className="flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-zinc-200/70 px-4 text-sm font-semibold dark:bg-zinc-800"
            >
              {category.station === 'bar' ? <Martini className="size-4" /> : <ChefHat className="size-4" />}
              {category.name}
            </a>
          ))}
        </nav>
      </div>

      <main className="space-y-8 px-4 pt-6">
        {sections.map(({ category, products }) => (
          <section key={category.id} id={`cat-${category.id}`} className="scroll-mt-32">
            <h2 className="mb-3 text-xl font-bold">{category.name}</h2>
            <ul className="space-y-3">
              {products.map((p) => {
                const extras = extrasFor(p);
                return (
                  <li
                    key={p.id}
                    className={cn(
                      'flex gap-3 rounded-2xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900',
                      !p.available && 'opacity-50',
                    )}
                  >
                    {p.image_url && (
                      <img src={p.image_url} alt="" loading="lazy" className="size-24 shrink-0 rounded-xl object-cover" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="font-semibold">{p.name}</h3>
                        <span className="tabular shrink-0 font-bold">{money(p.price)}</span>
                      </div>
                      {p.description && <p className="mt-0.5 text-sm text-zinc-500">{p.description}</p>}
                      {!p.available && <p className="mt-1 text-sm font-semibold text-red-600">Agotado por hoy</p>}
                      {extras.length > 0 && (
                        <p className="mt-1 text-xs text-zinc-500">
                          Extras: {extras.map((m) => `${m.name} (+${money(m.price_delta)})`).join(' · ')}
                        </p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
        {sections.length === 0 && <p className="py-16 text-center text-zinc-500">No encontramos productos con esa búsqueda.</p>}
      </main>

      <footer className="px-4 pt-10 text-center text-xs text-zinc-400">Pide a tu mesero · Precios en {tenant.currency}</footer>
    </div>
  );
}
