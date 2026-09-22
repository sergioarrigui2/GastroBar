'use client';

import { ArrowDownCircle, ArrowUpCircle, ChevronLeft, Eye, LockKeyhole, Printer, Receipt, Wallet } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { addCashMovementAction, closeCashSessionAction, openCashSessionAction } from '@/app/actions/cash';
import { getBillByOrderAction } from '@/app/actions/orders';
import { PaymentsList } from '@/components/billing/PaymentsList';
import { FlashMessage, toNumber, useAdminMutation } from '@/components/admin/useAdminMutation';
import { Button, Card, Input, Label } from '@/components/ui/primitives';
import { Sheet } from '@/components/ui/Sheet';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { useRealtimeRefresh } from '@/components/ui/useRealtimeRefresh';
import type { CashSession } from '@/lib/services/cash';
import { cn, formatCurrency, formatDateTime } from '@/lib/utils';
import type { AppRole, PaymentMethod, TableBill } from '@/types/domain';

const METHOD: Record<PaymentMethod, string> = { cash: 'Efectivo', card: 'Tarjeta', transfer: 'Transferencia', other: 'Otro' };

const openPrint = (path: string) => window.open(`${path}?auto=1`, '_blank', 'noopener,width=420,height=720');

export function CashRegister({
  tenant,
  role,
  session,
  openedByName,
  history,
  paidOrders,
}: {
  tenant: { id: string; name: string; currency: string; locale: string; timezone: string };
  role: AppRole;
  session: CashSession | null;
  openedByName: string | null;
  history: Array<{
    id: string;
    opened_at: string;
    closed_at: string | null;
    opening_float: number;
    expected_cash: number | null;
    counted_cash: number | null;
    difference: number | null;
  }>;
  paidOrders: Array<{ id: string; orderNumber: number; tableLabel: string | null; total: number; closedAt: string | null }>;
}) {
  const router = useRouter();
  const money = (n: number) => formatCurrency(n, tenant.currency, tenant.locale);
  const fmt = (iso: string) => formatDateTime(iso, tenant.locale, tenant.timezone);
  const { pending, flash, run } = useAdminMutation();

  const [openingFloat, setOpeningFloat] = useState('');
  const [movType, setMovType] = useState<'in' | 'out'>('out');
  const [movAmount, setMovAmount] = useState('');
  const [movReason, setMovReason] = useState('');
  const [counted, setCounted] = useState('');
  const [notes, setNotes] = useState('');

  useRealtimeRefresh({
    channel: `cash:${tenant.id}`,
    subscriptions: [{ table: 'payments', filter: `tenant_id=eq.${tenant.id}` }],
    onRefresh: () => router.refresh(),
    debounceMs: 1000,
  });

  const [viewing, setViewing] = useState<TableBill | null>(null);
  const openBill = async (orderId: string) => {
    const result = await getBillByOrderAction(orderId);
    if (result.ok) setViewing(result.data);
  };

  const r = session?.report;
  const countedValue = toNumber(counted);
  const difference = r && counted.trim() !== '' && countedValue >= 0 ? countedValue - r.expected_cash : null;

  return (
    <div className="mx-auto max-w-5xl space-y-5 px-4 py-5">
      <header className="flex items-center gap-2">
        <Link
          href={role === 'admin' ? '/admin' : '/waiter'}
          aria-label="Volver"
          className="grid size-10 place-items-center rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800"
        >
          <ChevronLeft className="size-6" />
        </Link>
        <div className="mr-auto">
          <h1 className="text-2xl font-bold">Caja</h1>
          <p className="text-sm text-zinc-500">{tenant.name}</p>
        </div>
        <ThemeToggle />
      </header>

      {!session || !r ? (
        <Card className="max-w-md space-y-4">
          <div className="flex items-center gap-3">
            <Wallet className="size-8 text-brand-600" />
            <div>
              <h2 className="font-semibold">La caja está cerrada</h2>
              <p className="text-sm text-zinc-500">Abre la caja con el efectivo inicial (base) para empezar el turno.</p>
            </div>
          </div>
          <div>
            <Label htmlFor="float">Base / fondo inicial ({tenant.currency})</Label>
            <Input id="float" inputMode="decimal" value={openingFloat} onChange={(e) => setOpeningFloat(e.target.value)} placeholder="0" />
          </div>
          <Button
            size="lg"
            className="w-full"
            disabled={pending}
            onClick={() => run(() => openCashSessionAction({ opening_float: toNumber(openingFloat || '0') || 0 }), 'Caja abierta')}
          >
            Abrir caja
          </Button>
        </Card>
      ) : (
        <>
          <p className="text-sm text-zinc-500">
            Abierta el {fmt(session.opened_at)}
            {openedByName && ` por ${openedByName}`} · Base {money(session.opening_float)}
          </p>

          <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Card>
              <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Ventas del turno</p>
              <p className="tabular mt-1 text-2xl font-bold">{money(r.sales)}</p>
              <p className="text-xs text-zinc-500">{r.orders_paid} cuentas · {r.payments_count} pagos</p>
            </Card>
            <Card>
              <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Propinas</p>
              <p className="tabular mt-1 text-2xl font-bold">{money(r.tips)}</p>
              <p className="text-xs text-zinc-500">En efectivo {money(r.cash_tips)}</p>
            </Card>
            <Card className="col-span-2">
              <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Efectivo esperado en caja</p>
              <p className="tabular mt-1 text-3xl font-black">{money(r.expected_cash)}</p>
              <p className="tabular text-xs text-zinc-500">
                Base {money(r.opening_float)} + ventas {money(r.cash_sales)} + propinas {money(r.cash_tips)} + entradas {money(r.cash_in)} − retiros{' '}
                {money(r.cash_out)}
              </p>
            </Card>
          </section>

          <div className="grid gap-5 lg:grid-cols-2">
            <Card>
              <h2 className="mb-3 font-semibold">Ventas por medio de pago</h2>
              <dl className="tabular space-y-2 text-sm">
                {(Object.keys(METHOD) as PaymentMethod[]).map((m) => (
                  <div key={m} className="flex justify-between">
                    <dt className="text-zinc-600 dark:text-zinc-400">
                      {METHOD[m]} ({r.by_method[m]?.count ?? 0})
                    </dt>
                    <dd className="font-semibold">{money(r.by_method[m]?.amount ?? 0)}</dd>
                  </div>
                ))}
              </dl>
              <dl className="tabular mt-3 space-y-1 border-t border-zinc-100 pt-3 text-xs text-zinc-500 dark:border-zinc-800">
                <div className="flex justify-between">
                  <dt>Descuentos · cortesías</dt>
                  <dd>
                    {money(r.discounts ?? 0)} · {money(r.comps ?? 0)}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt>Impuestos</dt>
                  <dd>{money(r.tax ?? 0)}</dd>
                </div>
                {(r.voided_count ?? 0) > 0 && (
                  <div className="flex justify-between text-red-600">
                    <dt>Pagos anulados ({r.voided_count})</dt>
                    <dd>{money(r.voided_amount ?? 0)}</dd>
                  </div>
                )}
              </dl>
              <Button variant="secondary" className="mt-4 w-full" onClick={() => openPrint(`/print/cash/${session.id}`)}>
                <Printer className="size-4" /> Imprimir corte parcial (X)
              </Button>
            </Card>

            <Card>
              <h2 className="mb-3 font-semibold">Entradas y retiros de efectivo</h2>
              <div className="mb-2 grid grid-cols-2 gap-1 rounded-xl bg-zinc-100 p-1 dark:bg-zinc-800">
                {(['out', 'in'] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setMovType(t)}
                    aria-pressed={movType === t}
                    className={cn(
                      'flex h-9 items-center justify-center gap-1 rounded-lg text-sm font-semibold',
                      movType === t ? 'bg-white shadow dark:bg-zinc-950' : 'text-zinc-500',
                    )}
                  >
                    {t === 'out' ? <ArrowUpCircle className="size-4" /> : <ArrowDownCircle className="size-4" />}
                    {t === 'out' ? 'Retiro' : 'Entrada'}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-[8rem_1fr] gap-2">
                <Input inputMode="decimal" value={movAmount} onChange={(e) => setMovAmount(e.target.value)} placeholder="Monto" aria-label="Monto" />
                <Input value={movReason} onChange={(e) => setMovReason(e.target.value)} placeholder="Motivo (compra de hielo, cambio…)" aria-label="Motivo" />
              </div>
              <Button
                variant="secondary"
                className="mt-2 w-full"
                disabled={pending || !(toNumber(movAmount) > 0) || !movReason.trim()}
                onClick={() =>
                  run(
                    () => addCashMovementAction({ type: movType, amount: toNumber(movAmount), reason: movReason }),
                    movType === 'out' ? 'Retiro registrado' : 'Entrada registrada',
                    () => {
                      setMovAmount('');
                      setMovReason('');
                    },
                  )
                }
              >
                Registrar
              </Button>
              {r.movements.length > 0 && (
                <ul className="tabular mt-3 space-y-1 text-sm">
                  {r.movements.map((m, i) => (
                    <li key={i} className="flex justify-between gap-2">
                      <span className="truncate">{m.reason}</span>
                      <span className={cn('font-semibold', m.type === 'out' ? 'text-red-600' : 'text-emerald-600')}>
                        {m.type === 'out' ? '−' : '+'}
                        {money(m.amount)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card>
              <h2 className="mb-3 font-semibold">Cuentas pagadas en este turno</h2>
              {paidOrders.length === 0 ? (
                <p className="text-sm text-zinc-500">Aún no hay cuentas pagadas.</p>
              ) : (
                <ul className="tabular max-h-72 divide-y divide-zinc-100 overflow-y-auto text-sm dark:divide-zinc-800">
                  {paidOrders.map((o) => (
                    <li key={o.id} className="flex items-center gap-2 py-2">
                      <Receipt className="size-4 text-zinc-400" />
                      <span className="flex-1">
                        #{o.orderNumber} · {o.tableLabel ? `Mesa ${o.tableLabel}` : 'Barra'}
                        {o.closedAt && <span className="text-zinc-500"> · {fmt(o.closedAt)}</span>}
                      </span>
                      <span className="font-semibold">{money(o.total)}</span>
                      <Button variant="ghost" size="sm" aria-label={`Ver pagos ${o.orderNumber}`} onClick={() => openBill(o.id)}>
                        <Eye className="size-4" />
                      </Button>
                      <Button variant="ghost" size="sm" aria-label={`Imprimir recibo ${o.orderNumber}`} onClick={() => openPrint(`/print/bill/${o.id}`)}>
                        <Printer className="size-4" />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card className="border-2 border-zinc-900 dark:border-zinc-100">
              <h2 className="mb-3 flex items-center gap-2 font-semibold">
                <LockKeyhole className="size-4" /> Cerrar caja (arqueo)
              </h2>
              <Label htmlFor="counted">Efectivo contado ({tenant.currency})</Label>
              <Input id="counted" inputMode="decimal" value={counted} onChange={(e) => setCounted(e.target.value)} placeholder="0" />
              {difference !== null && (
                <p
                  className={cn(
                    'tabular mt-2 rounded-xl p-2 text-sm font-semibold',
                    Math.abs(difference) < 1
                      ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200'
                      : 'bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-300',
                  )}
                >
                  {Math.abs(difference) < 1 ? 'Cuadra exacto' : difference > 0 ? `Sobran ${money(difference)}` : `Faltan ${money(-difference)}`}
                </p>
              )}
              <Label htmlFor="notes">
                <span className="mt-3 block">Observaciones</span>
              </Label>
              <Input id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Opcional" />
              <Button
                size="lg"
                variant="danger"
                className="mt-3 w-full"
                disabled={pending || counted.trim() === '' || !(countedValue >= 0)}
                onClick={() => {
                  if (!confirm('¿Cerrar la caja? Se generará el reporte Z y no podrá modificarse.')) return;
                  run(
                    () => closeCashSessionAction({ counted_cash: countedValue, notes: notes || undefined }),
                    'Caja cerrada',
                    (sessionId) => {
                      setCounted('');
                      setNotes('');
                      openPrint(`/print/cash/${sessionId}`);
                    },
                  );
                }}
              >
                Cerrar caja e imprimir Z
              </Button>
            </Card>
          </div>
        </>
      )}

      <Card>
        <h2 className="mb-3 font-semibold">Cierres anteriores</h2>
        {history.length === 0 ? (
          <p className="text-sm text-zinc-500">Todavía no hay cierres.</p>
        ) : (
          <div className="-mx-4 overflow-x-auto">
            <table className="tabular w-full min-w-[34rem] text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="px-4 py-2 font-medium">Turno</th>
                  <th className="px-4 py-2 text-right font-medium">Esperado</th>
                  <th className="px-4 py-2 text-right font-medium">Contado</th>
                  <th className="px-4 py-2 text-right font-medium">Diferencia</th>
                  <th className="px-2 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {history.map((h) => (
                  <tr key={h.id}>
                    <td className="px-4 py-2">
                      {fmt(h.opened_at)} → {h.closed_at ? fmt(h.closed_at) : '—'}
                    </td>
                    <td className="px-4 py-2 text-right">{money(h.expected_cash ?? 0)}</td>
                    <td className="px-4 py-2 text-right">{money(h.counted_cash ?? 0)}</td>
                    <td
                      className={cn(
                        'px-4 py-2 text-right font-semibold',
                        Math.abs(h.difference ?? 0) < 1 ? 'text-emerald-600' : 'text-red-600',
                      )}
                    >
                      {(h.difference ?? 0) > 0 ? '+' : ''}
                      {money(h.difference ?? 0)}
                    </td>
                    <td className="px-2 py-2 text-right">
                      <Button variant="ghost" size="sm" aria-label="Imprimir reporte Z" onClick={() => openPrint(`/print/cash/${h.id}`)}>
                        <Printer className="size-4" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {viewing && (
        <Sheet
          open
          onClose={() => setViewing(null)}
          title={`Cuenta #${viewing.order.order_number}`}
          subtitle={`Total ${money(viewing.order.total)} · Pagado ${money(viewing.order.paid_amount)}`}
        >
          <div className="space-y-3">
            <PaymentsList
              payments={viewing.payments}
              money={money}
              canVoid={role === 'admin'}
              onVoided={() => {
                void openBill(viewing.order.id);
                router.refresh();
              }}
            />
            <p className="text-xs text-zinc-500">
              {role === 'admin'
                ? 'Al anular un pago la cuenta se reabre con el saldo pendiente y la mesa vuelve a ocupada. Los pagos de cajas ya cerradas no se pueden anular.'
                : 'Sólo un administrador puede anular pagos.'}
            </p>
          </div>
        </Sheet>
      )}
      <FlashMessage flash={flash} />
    </div>
  );
}
