'use client';

import { useState, useTransition } from 'react';
import { applyOrderDiscountAction } from '@/app/actions/orders';
import { Button, Input, Label } from '@/components/ui/primitives';
import { Sheet } from '@/components/ui/Sheet';
import { cn } from '@/lib/utils';
import type { Order } from '@/types/domain';

const REASONS = ['Cliente frecuente', 'Error de servicio', 'Demora en la comanda', 'Consumo de empleado', 'Promoción'];

export function DiscountSheet({
  order,
  money,
  onClose,
  onApplied,
}: {
  order: Order;
  money: (n: number) => string;
  onClose: () => void;
  onApplied: () => void;
}) {
  const [type, setType] = useState<'percent' | 'amount'>(order.discount_type ?? 'percent');
  const [value, setValue] = useState(order.discount_value ? String(order.discount_value) : '');
  const [reason, setReason] = useState(order.discount_reason ?? '');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const numeric = Number(value.replace(',', '.')) || 0;
  const preview = type === 'percent' ? Math.round((order.subtotal * Math.min(numeric, 100)) / 100) : Math.min(numeric, order.subtotal);

  const submit = (clear = false) => {
    setError(null);
    if (!clear && numeric <= 0) return setError('Indica el valor del descuento');
    if (!clear && !reason.trim()) return setError('Indica el motivo del descuento');
    startTransition(async () => {
      const result = await applyOrderDiscountAction({
        order_id: order.id,
        type: clear ? null : type,
        value: clear ? 0 : numeric,
        reason: clear ? undefined : reason,
      });
      if (!result.ok) return setError(result.error);
      onApplied();
    });
  };

  return (
    <Sheet
      open
      onClose={onClose}
      title="Descuento de la cuenta"
      subtitle={`Subtotal ${money(order.subtotal)}`}
      footer={
        <div className="space-y-2">
          {error && (
            <p role="alert" className="text-sm font-medium text-red-600">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            {order.discount_total > 0 && (
              <Button variant="ghost" className="text-red-600" disabled={pending} onClick={() => submit(true)}>
                Quitar descuento
              </Button>
            )}
            <Button size="lg" className="flex-1" disabled={pending} onClick={() => submit()}>
              {pending ? 'Aplicando…' : `Aplicar −${money(preview)}`}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-1 rounded-xl bg-zinc-100 p-1 dark:bg-zinc-800">
          {(['percent', 'amount'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setType(t)}
              aria-pressed={type === t}
              className={cn('h-10 rounded-lg text-sm font-semibold', type === t ? 'bg-white shadow dark:bg-zinc-950' : 'text-zinc-500')}
            >
              {t === 'percent' ? 'Porcentaje' : 'Monto fijo'}
            </button>
          ))}
        </div>
        <div>
          <Label htmlFor="d-value">{type === 'percent' ? 'Porcentaje (%)' : 'Monto'}</Label>
          <Input id="d-value" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} placeholder="0" autoFocus />
          {type === 'percent' && (
            <div className="mt-2 flex gap-2">
              {[5, 10, 15, 20, 50].map((p) => (
                <button key={p} onClick={() => setValue(String(p))} className="h-9 flex-1 rounded-lg bg-zinc-100 text-sm font-semibold dark:bg-zinc-800">
                  {p}%
                </button>
              ))}
            </div>
          )}
        </div>
        <div>
          <Label htmlFor="d-reason">Motivo (obligatorio)</Label>
          <Input id="d-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ej. Cliente frecuente" />
          <div className="mt-2 flex flex-wrap gap-2">
            {REASONS.map((r) => (
              <button
                key={r}
                onClick={() => setReason(r)}
                className={cn('h-8 rounded-full px-3 text-xs', reason === r ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900' : 'bg-zinc-100 dark:bg-zinc-800')}
              >
                {r}
              </button>
            ))}
          </div>
        </div>
      </div>
    </Sheet>
  );
}
