'use client';

import { Ban } from 'lucide-react';
import { useState, useTransition } from 'react';
import { voidPaymentAction } from '@/app/actions/payments';
import { cn } from '@/lib/utils';
import type { Payment, PaymentMethod } from '@/types/domain';

const METHOD: Record<PaymentMethod, string> = { cash: 'Efectivo', card: 'Tarjeta', transfer: 'Transferencia', other: 'Otro' };

/** Pagos de una cuenta; el admin puede anularlos indicando el motivo. */
export function PaymentsList({
  payments,
  money,
  canVoid,
  onVoided,
}: {
  payments: Payment[];
  money: (n: number) => string;
  canVoid: boolean;
  onVoided: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (payments.length === 0) return null;

  const voidPayment = (payment: Payment) => {
    const reason = prompt(`Motivo para anular el pago de ${money(payment.amount)} (${METHOD[payment.method]}):`);
    if (!reason?.trim()) return;
    setError(null);
    startTransition(async () => {
      const result = await voidPaymentAction({ payment_id: payment.id, reason });
      if (!result.ok) setError(result.error);
      else onVoided();
    });
  };

  return (
    <section>
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">Pagos</h3>
      <ul className="divide-y divide-zinc-200 rounded-2xl border border-zinc-200 text-sm dark:divide-zinc-800 dark:border-zinc-800">
        {payments.map((p) => (
          <li key={p.id} className={cn('flex items-center gap-2 px-3 py-2', p.voided_at && 'opacity-50')}>
            <span className="min-w-0 flex-1">
              <span className={cn('block font-medium', p.voided_at && 'line-through')}>
                {METHOD[p.method]}
                {p.split_label && <span className="text-zinc-500"> · {p.split_label}</span>}
              </span>
              {p.voided_at ? (
                <span className="text-xs text-red-600">Anulado: {p.void_reason}</span>
              ) : (
                p.tip > 0 && <span className="text-xs text-zinc-500">Propina {money(p.tip)}</span>
              )}
            </span>
            <span className={cn('tabular font-semibold', p.voided_at && 'line-through')}>{money(p.amount)}</span>
            {canVoid && !p.voided_at && (
              <button
                onClick={() => voidPayment(p)}
                disabled={pending}
                aria-label="Anular pago"
                title="Anular pago"
                className="grid size-9 place-items-center rounded-lg text-zinc-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10"
              >
                <Ban className="size-4" />
              </button>
            )}
          </li>
        ))}
      </ul>
      {error && <p className="mt-1 text-sm font-medium text-red-600">{error}</p>}
    </section>
  );
}
