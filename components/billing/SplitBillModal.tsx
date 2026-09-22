'use client';

import { Banknote, Check, CreditCard, Landmark, Plus, Users, Wallet } from 'lucide-react';
import { useMemo, useState, useTransition } from 'react';
import { registerPaymentsAction } from '@/app/actions/payments';
import { Button, Input, Stepper } from '@/components/ui/primitives';
import { Sheet } from '@/components/ui/Sheet';
import {
  buildEqualShares,
  checkCustomSplit,
  currencyDecimals,
  remainingBalance,
  splitByItems,
  suggestedTip,
  type ItemAssignments,
  type SplitShare,
} from '@/lib/billing/split-bill';
import { cn, formatCurrency } from '@/lib/utils';
import type { PaymentMethod, RegisterPaymentsResult, SplitType, TableBill } from '@/types/domain';

type Mode = SplitType;

const MODES: Array<{ id: Mode; label: string }> = [
  { id: 'full', label: 'Completa' },
  { id: 'equal', label: 'Iguales' },
  { id: 'by_item', label: 'Por ítem' },
  { id: 'custom', label: 'Montos' },
];

const METHODS: Array<{ id: PaymentMethod; label: string; icon: typeof CreditCard }> = [
  { id: 'card', label: 'Tarjeta', icon: CreditCard },
  { id: 'cash', label: 'Efectivo', icon: Banknote },
  { id: 'transfer', label: 'Transf.', icon: Landmark },
  { id: 'other', label: 'Otro', icon: Wallet },
];

const GUEST_COLORS = [
  'bg-sky-500',
  'bg-fuchsia-500',
  'bg-emerald-500',
  'bg-orange-500',
  'bg-violet-500',
  'bg-rose-500',
  'bg-lime-500',
  'bg-cyan-500',
];

type ShareMeta = { method: PaymentMethod; tipPercent: number | null; tipCustom: string; charge: boolean };
const defaultMeta = (): ShareMeta => ({ method: 'card', tipPercent: null, tipCustom: '', charge: true });

export function SplitBillModal({
  open,
  onClose,
  bill,
  currency,
  locale,
  title,
  onRegistered,
}: {
  open: boolean;
  onClose: () => void;
  bill: TableBill;
  currency: string;
  locale: string;
  title: string;
  onRegistered: (result: RegisterPaymentsResult) => void;
}) {
  const decimals = currencyDecimals(currency);
  const money = (n: number) => formatCurrency(n, currency, locale);
  const remaining = remainingBalance(bill.order.total, bill.order.paid_amount, decimals);

  const [mode, setMode] = useState<Mode>('equal');
  const [parts, setParts] = useState(Math.max(2, bill.order.guests ?? 2));
  const [guests, setGuests] = useState<string[]>(['Comensal 1', 'Comensal 2']);
  const [activeGuest, setActiveGuest] = useState(0);
  const [assignments, setAssignments] = useState<ItemAssignments>({});
  const [customAmounts, setCustomAmounts] = useState<string[]>(['', '']);
  const [meta, setMeta] = useState<ShareMeta[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const payableItems = useMemo(
    () => bill.items.filter((i) => i.line_total - i.allocated > 0.0001),
    [bill.items],
  );

  const { shares, unassigned, valid } = useMemo((): { shares: SplitShare[]; unassigned: number; valid: boolean } => {
    switch (mode) {
      case 'full':
        return { shares: [{ label: 'Cuenta completa', amount: remaining, allocations: [] }], unassigned: 0, valid: remaining > 0 };
      case 'equal':
        return { shares: buildEqualShares(remaining, parts, decimals), unassigned: 0, valid: remaining > 0 };
      case 'custom': {
        const amounts = customAmounts.map((v) => Number(v.replace(',', '.')) || 0);
        const check = checkCustomSplit(amounts, remaining, decimals);
        return {
          shares: amounts.map((amount, i) => ({ label: `Pago ${i + 1}`, amount, allocations: [] })),
          unassigned: check.difference,
          valid: check.valid,
        };
      }
      case 'by_item': {
        const result = splitByItems(
          payableItems.map((i) => ({ id: i.id, name: i.product_name, lineTotal: i.line_total, allocated: i.allocated })),
          assignments,
          guests,
          decimals,
        );
        return { ...result, valid: result.shares.some((s) => s.amount > 0) };
      }
    }
  }, [mode, remaining, parts, decimals, customAmounts, payableItems, assignments, guests]);

  const metaAt = (i: number) => meta[i] ?? defaultMeta();
  const updateMeta = (i: number, patch: Partial<ShareMeta>) =>
    setMeta((prev) => {
      const next = [...prev];
      for (let k = next.length; k <= i; k++) next[k] = defaultMeta();
      next[i] = { ...metaAt(i), ...patch };
      return next;
    });

  const tipFor = (share: SplitShare, i: number) => {
    const m = metaAt(i);
    if (m.tipPercent !== null) return suggestedTip(share.amount, m.tipPercent, decimals);
    return Math.max(0, Number(m.tipCustom.replace(',', '.')) || 0);
  };

  const selected = shares
    .map((share, i) => ({ share, i }))
    .filter(({ share, i }) => share.amount > 0 && metaAt(i).charge);
  const chargeTotal = selected.reduce((s, { share }) => s + share.amount, 0);
  const tipTotal = selected.reduce((s, { share, i }) => s + tipFor(share, i), 0);

  const toggleAssignment = (itemId: string) => {
    setAssignments((prev) => {
      const current = prev[itemId] ?? [];
      const next = current.includes(activeGuest) ? current.filter((g) => g !== activeGuest) : [...current, activeGuest];
      return { ...prev, [itemId]: next };
    });
  };

  const submit = () => {
    setError(null);
    if (!valid || selected.length === 0) {
      setError('Revisa la división: no hay montos válidos para cobrar');
      return;
    }
    startTransition(async () => {
      const result = await registerPaymentsAction({
        order_id: bill.order.id,
        split_type: mode,
        payments: selected.map(({ share, i }) => ({
          amount: share.amount,
          tip: tipFor(share, i),
          method: metaAt(i).method,
          label: share.label,
          allocations: mode === 'by_item' ? share.allocations : [],
        })),
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setMeta([]);
      setAssignments({});
      onRegistered(result.data);
    });
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={`Cobrar · ${title}`}
      subtitle={
        <span className="tabular">
          Total {money(bill.order.total)} · Pagado {money(bill.order.paid_amount)} ·{' '}
          <b className="text-zinc-900 dark:text-zinc-100">Saldo {money(remaining)}</b>
        </span>
      }
      footer={
        <div className="space-y-2">
          {error && (
            <p role="alert" className="text-sm font-medium text-red-600">
              {error}
            </p>
          )}
          <Button size="xl" variant="success" className="w-full" onClick={submit} disabled={pending || !valid || selected.length === 0}>
            <Check className="size-5" />
            {pending
              ? 'Registrando…'
              : `Cobrar ${money(chargeTotal)}${tipTotal > 0 ? ` + ${money(tipTotal)} propina` : ''}`}
          </Button>
        </div>
      }
    >
      {/* Selector de modo */}
      <div role="tablist" aria-label="Tipo de división" className="mb-4 grid grid-cols-4 gap-1 rounded-2xl bg-zinc-100 p-1 dark:bg-zinc-800">
        {MODES.map((m) => (
          <button
            key={m.id}
            role="tab"
            aria-selected={mode === m.id}
            onClick={() => {
              setMode(m.id);
              setMeta([]);
            }}
            className={cn(
              'h-10 rounded-xl text-sm font-semibold transition-colors',
              mode === m.id ? 'bg-white shadow dark:bg-zinc-950' : 'text-zinc-500 dark:text-zinc-400',
            )}
          >
            {m.label}
          </button>
        ))}
      </div>

      {mode === 'equal' && (
        <div className="mb-4 flex items-center justify-between rounded-2xl border border-zinc-200 p-3 dark:border-zinc-800">
          <span className="flex items-center gap-2 font-medium">
            <Users className="size-5" /> Personas
          </span>
          <Stepper value={parts} onChange={setParts} min={2} max={30} />
        </div>
      )}

      {mode === 'custom' && (
        <div className="mb-4 space-y-2">
          {customAmounts.map((value, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="w-16 shrink-0 text-sm text-zinc-500">Pago {i + 1}</span>
              <Input
                inputMode="decimal"
                placeholder="0"
                value={value}
                onChange={(e) => setCustomAmounts((prev) => prev.map((v, k) => (k === i ? e.target.value : v)))}
              />
              {customAmounts.length > 1 && (
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Quitar pago ${i + 1}`}
                  onClick={() => setCustomAmounts((prev) => prev.filter((_, k) => k !== i))}
                >
                  ✕
                </Button>
              )}
            </div>
          ))}
          <div className="flex items-center justify-between">
            <Button variant="secondary" size="sm" onClick={() => setCustomAmounts((prev) => [...prev, ''])}>
              <Plus className="size-4" /> Agregar pago
            </Button>
            <span className={cn('tabular text-sm font-semibold', unassigned < 0 ? 'text-red-600' : 'text-zinc-500')}>
              {unassigned < 0 ? `Excede ${money(-unassigned)}` : `Sin asignar ${money(unassigned)}`}
            </span>
          </div>
        </div>
      )}

      {mode === 'by_item' && (
        <div className="mb-4">
          <p className="mb-2 text-sm text-zinc-500">
            Elige un comensal y toca sus ítems. Un ítem tocado por varios se divide entre ellos.
          </p>
          <div className="scrollbar-none -mx-5 mb-3 flex gap-2 overflow-x-auto px-5">
            {guests.map((g, i) => (
              <button
                key={i}
                onClick={() => setActiveGuest(i)}
                className={cn(
                  'flex h-10 shrink-0 items-center gap-2 rounded-full border px-3 text-sm font-semibold',
                  activeGuest === i
                    ? 'border-zinc-900 bg-zinc-900 text-white dark:border-white dark:bg-white dark:text-zinc-900'
                    : 'border-zinc-300 dark:border-zinc-700',
                )}
              >
                <span className={cn('size-3 rounded-full', GUEST_COLORS[i % GUEST_COLORS.length])} />
                {g}
              </button>
            ))}
            <button
              onClick={() => {
                setGuests((prev) => [...prev, `Comensal ${prev.length + 1}`]);
                setActiveGuest(guests.length);
              }}
              className="flex h-10 shrink-0 items-center gap-1 rounded-full border border-dashed border-zinc-400 px-3 text-sm font-semibold"
            >
              <Plus className="size-4" /> Comensal
            </button>
          </div>
          <ul className="divide-y divide-zinc-200 rounded-2xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
            {payableItems.map((item) => {
              const owners = assignments[item.id] ?? [];
              return (
                <li key={item.id}>
                  <button
                    onClick={() => toggleAssignment(item.id)}
                    aria-pressed={owners.includes(activeGuest)}
                    className="flex min-h-14 w-full items-center gap-3 px-3 py-2 text-left active:bg-zinc-50 dark:active:bg-zinc-800"
                  >
                    <span className="flex w-10 shrink-0 flex-wrap gap-0.5">
                      {owners.map((g) => (
                        <span key={g} className={cn('size-3 rounded-full', GUEST_COLORS[g % GUEST_COLORS.length])} />
                      ))}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">
                        {item.quantity}× {item.product_name}
                      </span>
                      {item.allocated > 0 && (
                        <span className="text-xs text-zinc-500">Ya pagado {money(item.allocated)}</span>
                      )}
                    </span>
                    <span className="tabular font-semibold">{money(item.line_total - item.allocated)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          {unassigned > 0 && (
            <p className="tabular mt-2 text-right text-sm text-zinc-500">Sin asignar {money(unassigned)}</p>
          )}
        </div>
      )}

      {/* Partes resultantes */}
      <ul className="space-y-3">
        {shares.map((share, i) => {
          const m = metaAt(i);
          const disabled = share.amount <= 0;
          return (
            <li
              key={`${mode}-${i}`}
              className={cn(
                'rounded-2xl border p-3 transition-opacity',
                m.charge && !disabled ? 'border-zinc-300 dark:border-zinc-700' : 'border-zinc-200 opacity-50 dark:border-zinc-800',
              )}
            >
              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  className="size-5 accent-emerald-600"
                  checked={m.charge && !disabled}
                  disabled={disabled}
                  onChange={(e) => updateMeta(i, { charge: e.target.checked })}
                />
                <span className="flex-1 font-semibold">{share.label}</span>
                <span className="tabular text-lg font-bold">{money(share.amount)}</span>
              </label>
              {m.charge && !disabled && (
                <div className="mt-3 space-y-2">
                  <div className="grid grid-cols-4 gap-1">
                    {METHODS.map(({ id, label, icon: Icon }) => (
                      <button
                        key={id}
                        onClick={() => updateMeta(i, { method: id })}
                        aria-pressed={m.method === id}
                        className={cn(
                          'flex h-11 flex-col items-center justify-center rounded-xl text-[11px] font-semibold',
                          m.method === id
                            ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900'
                            : 'bg-zinc-100 dark:bg-zinc-800',
                        )}
                      >
                        <Icon className="size-4" />
                        {label}
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="mr-1 text-xs font-medium text-zinc-500">Propina</span>
                    {[0, 10, 15].map((pct) => (
                      <button
                        key={pct}
                        onClick={() => updateMeta(i, { tipPercent: pct, tipCustom: '' })}
                        className={cn(
                          'h-9 rounded-lg px-3 text-sm font-semibold',
                          m.tipPercent === pct || (pct === 0 && m.tipPercent === null && !m.tipCustom)
                            ? 'bg-brand-500 text-zinc-950'
                            : 'bg-zinc-100 dark:bg-zinc-800',
                        )}
                      >
                        {pct === 0 ? 'No' : `${pct}%`}
                      </button>
                    ))}
                    <Input
                      className="h-9 flex-1 text-sm"
                      inputMode="decimal"
                      placeholder="Otra"
                      aria-label="Propina personalizada"
                      value={m.tipCustom}
                      onChange={(e) => updateMeta(i, { tipCustom: e.target.value, tipPercent: null })}
                    />
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </Sheet>
  );
}
