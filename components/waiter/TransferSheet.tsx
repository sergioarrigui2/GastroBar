'use client';

import { ArrowRightLeft } from 'lucide-react';
import { useMemo, useState, useTransition } from 'react';
import { transferOrderAction, transferOrderItemsAction } from '@/app/actions/orders';
import { Sheet } from '@/components/ui/Sheet';
import type { TableStatusEntry } from '@/lib/services/tables';
import { cn } from '@/lib/utils';

/**
 * Elegir la mesa destino para pasar una cuenta (o algunos de sus productos).
 * Mesa libre → se traslada; mesa con cuenta → se unen (los abonos viajan con la cuenta).
 */
export function TransferSheet({
  orderId,
  itemIds,
  fromTableId,
  fromLabel,
  tables,
  money,
  onClose,
  onDone,
  notify,
}: {
  orderId: string;
  /** Si viene, sólo se pasan estos productos (separar cuenta). */
  itemIds?: string[];
  fromTableId: string;
  fromLabel: string;
  tables: TableStatusEntry[];
  money: (n: number) => string;
  onClose: () => void;
  onDone: (destTableId: string, mode: 'moved' | 'merged' | 'split') => void;
  notify: (text: string, tone?: 'ok' | 'error') => void;
}) {
  const [pending, start] = useTransition();
  const [target, setTarget] = useState<TableStatusEntry | null>(null);
  const zones = useMemo(() => {
    const map = new Map<string, TableStatusEntry[]>();
    for (const t of tables) if (t.id !== fromTableId) map.set(t.zone_name, [...(map.get(t.zone_name) ?? []), t]);
    return [...map.entries()];
  }, [tables, fromTableId]);

  const partial = Boolean(itemIds?.length);
  const what = partial ? `${itemIds!.length} producto(s)` : 'la cuenta';
  const outcome = !target
    ? null
    : target.open_order
      ? partial
        ? `Los ${itemIds!.length} producto(s) se suman a la cuenta de Mesa ${target.label}.`
        : `Se unen las cuentas: todo lo de Mesa ${fromLabel} (incluidos sus abonos) pasa a Mesa ${target.label}, y Mesa ${fromLabel} queda libre.`
      : partial
        ? `Se abre una cuenta nueva en Mesa ${target.label} con esos productos.`
        : `La cuenta se traslada a Mesa ${target.label} y Mesa ${fromLabel} queda libre.`;

  const confirm = () => {
    if (!target) return;
    start(async () => {
      const result = partial ? await transferOrderItemsAction(itemIds!, target.id) : await transferOrderAction(orderId, target.id);
      if (!result.ok) return notify(result.error, 'error');
      const { mode } = result.data;
      notify(
        mode === 'merged'
          ? `Cuentas unidas en Mesa ${target.label}. Mesa ${fromLabel} quedó libre.`
          : mode === 'moved'
            ? `Cuenta pasada a Mesa ${target.label}. Mesa ${fromLabel} quedó libre.`
            : `${itemIds!.length} producto(s) pasados a Mesa ${target.label}.`,
      );
      onDone(target.id, mode);
    });
  };

  return (
    <Sheet
      open
      onClose={onClose}
      title={`Pasar ${what} de Mesa ${fromLabel}`}
      subtitle="Elige la mesa destino"
      footer={
        <div className="space-y-2">
          {outcome && <p className="rounded-xl bg-zinc-100 p-3 text-sm dark:bg-zinc-800">{outcome}</p>}
          <button
            type="button"
            disabled={!target || pending}
            onClick={confirm}
            className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-brand-500 text-lg font-bold text-zinc-950 disabled:bg-zinc-200 disabled:text-zinc-400 dark:disabled:bg-zinc-800"
          >
            <ArrowRightLeft className="size-5" />
            {pending ? 'Pasando…' : target ? (target.open_order && !partial ? `Unir con Mesa ${target.label}` : `Pasar a Mesa ${target.label}`) : 'Elige una mesa'}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        {zones.map(([zone, list]) => (
          <section key={zone}>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">{zone}</h3>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {list.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  aria-pressed={target?.id === t.id}
                  onClick={() => setTarget(t)}
                  className={cn(
                    'rounded-xl border p-2.5 text-left transition',
                    target?.id === t.id ? 'border-brand-500 bg-brand-50 dark:bg-brand-500/10' : 'border-zinc-200 dark:border-zinc-700',
                  )}
                >
                  <span className="block font-bold">{t.label}</span>
                  <span className={cn('block text-xs', t.open_order ? 'text-amber-700 dark:text-amber-300' : 'text-emerald-700 dark:text-emerald-400')}>
                    {t.open_order ? `Cuenta ${money(t.open_order.total)}` : t.status === 'reserved' ? 'Reservada' : t.status === 'cleaning' ? 'En limpieza' : 'Libre'}
                  </span>
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
    </Sheet>
  );
}
