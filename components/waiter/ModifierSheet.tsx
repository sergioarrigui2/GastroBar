'use client';

import { useState } from 'react';
import { Button, Stepper } from '@/components/ui/primitives';
import { Sheet } from '@/components/ui/Sheet';
import { cn, formatCurrency } from '@/lib/utils';
import type { MenuProduct, Modifier } from '@/types/domain';

/** Notas rápidas de un toque según la estación del producto. */
const QUICK_NOTES: Record<MenuProduct['station'], string[]> = {
  bar: ['Poco hielo', 'Sin azúcar', 'Bien frío', 'Para compartir', 'Sin pitillo'],
  kitchen: ['Sin cebolla', 'Salsa aparte', 'Sin picante', 'Alergia: frutos secos', 'Para compartir', 'Sale primero'],
};

export type ModifierSelection = { quantity: number; modifiers: Modifier[]; notes: string };

export function ModifierSheet({
  product,
  modifiers,
  initial,
  currency,
  locale,
  onClose,
  onConfirm,
}: {
  product: MenuProduct;
  modifiers: Modifier[];
  initial?: ModifierSelection;
  currency: string;
  locale: string;
  onClose: () => void;
  onConfirm: (selection: ModifierSelection) => void;
}) {
  const [quantity, setQuantity] = useState(initial?.quantity ?? 1);
  const [selected, setSelected] = useState<Set<string>>(new Set(initial?.modifiers.map((m) => m.id)));
  const [notes, setNotes] = useState(initial?.notes ?? '');

  const chosen = modifiers.filter((m) => selected.has(m.id));
  const unitPrice = product.price + chosen.reduce((s, m) => s + m.price_delta, 0);
  const money = (n: number) => formatCurrency(n, currency, locale);
  const maxQty = product.available_portions ?? 99;

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleNote = (note: string) => {
    const parts = notes
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
    const next = parts.includes(note) ? parts.filter((p) => p !== note) : [...parts, note];
    setNotes(next.join(', ').slice(0, 280));
  };

  return (
    <Sheet
      open
      onClose={onClose}
      title={product.name}
      subtitle={
        <>
          {money(product.price)}
          {product.available_portions !== null && ` · Quedan ${product.available_portions}`}
        </>
      }
      footer={
        <div className="flex items-center gap-3">
          <Stepper value={quantity} onChange={setQuantity} max={Math.max(1, Math.min(99, maxQty))} />
          <Button
            size="xl"
            className="min-w-0 flex-1 whitespace-nowrap px-3 text-base"
            onClick={() => onConfirm({ quantity, modifiers: chosen, notes: notes.trim() })}
          >
            {initial ? 'Actualizar' : 'Agregar'} · {money(unitPrice * quantity)}
          </Button>
        </div>
      }
    >
      {product.description && <p className="mb-4 text-sm text-zinc-500">{product.description}</p>}

      {modifiers.length > 0 && (
        <section className="mb-5">
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-500">Modificadores</h3>
          <div className="flex flex-wrap gap-2">
            {modifiers.map((m) => {
              const on = selected.has(m.id);
              return (
                <button
                  key={m.id}
                  onClick={() => toggle(m.id)}
                  aria-pressed={on}
                  className={cn(
                    'min-h-12 rounded-2xl border-2 px-4 text-sm font-semibold transition-colors',
                    on
                      ? 'border-brand-500 bg-brand-50 text-zinc-900 dark:bg-brand-500/15 dark:text-brand-100'
                      : 'border-zinc-200 dark:border-zinc-700',
                  )}
                >
                  {m.name}
                  {m.price_delta !== 0 && (
                    <span className="ml-1 text-zinc-500">
                      {m.price_delta > 0 ? '+' : ''}
                      {money(m.price_delta)}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </section>
      )}

      <section>
        <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-500">Notas para {product.station === 'bar' ? 'barra' : 'cocina'}</h3>
        <div className="mb-2 flex flex-wrap gap-2">
          {QUICK_NOTES[product.station].map((note) => (
            <button
              key={note}
              onClick={() => toggleNote(note)}
              className={cn(
                'h-9 rounded-full px-3 text-sm',
                notes.includes(note) ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900' : 'bg-zinc-100 dark:bg-zinc-800',
              )}
            >
              {note}
            </button>
          ))}
        </div>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value.slice(0, 280))}
          rows={2}
          placeholder="Nota especial…"
          className="w-full rounded-xl border border-zinc-300 bg-white p-3 text-base dark:border-zinc-700 dark:bg-zinc-900"
        />
      </section>
    </Sheet>
  );
}
