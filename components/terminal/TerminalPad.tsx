'use client';

import { ArrowLeft, Delete } from 'lucide-react';
import { useActionState, useEffect, useRef, useState } from 'react';
import { type PinState, signInWithPinAction } from '@/app/actions/terminal';
import { cn } from '@/lib/utils';
import type { AppRole } from '@/types/domain';

const ROLE_LABELS: Partial<Record<AppRole, string>> = { waiter: 'Mesero', cashier: 'Caja', kitchen: 'Cocina', bar: 'Barra' };
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

type Staff = { id: string; name: string; role: AppRole };

/** Pantalla de la tablet compartida: cada empleado toca su nombre y marca su PIN. */
export function TerminalPad({ staff }: { staff: Staff[] }) {
  const [selected, setSelected] = useState<Staff | null>(null);
  const [pin, setPin] = useState('');
  const [state, action, pending] = useActionState<PinState, FormData>(signInWithPinAction, null);
  const formRef = useRef<HTMLFormElement>(null);

  // Tras un error, limpiar el PIN para reintentar.
  useEffect(() => {
    if (state?.error) setPin('');
  }, [state]);

  const press = (d: string) => setPin((p) => (p.length < 6 ? p + d : p));

  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === 'Backspace') setPin((p) => p.slice(0, -1));
      else if (e.key === 'Enter' && pin.length >= 4) formRef.current?.requestSubmit();
      else if (e.key === 'Escape') setSelected(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected, pin]);

  if (!selected) {
    if (!staff.length) {
      return (
        <p className="rounded-2xl bg-zinc-100 p-6 text-center text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
          Todavía nadie tiene PIN. El administrador lo asigna en <b>Personal</b>.
        </p>
      );
    }
    return (
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {staff.map((s) => (
          <li key={s.id}>
            <button
              type="button"
              onClick={() => {
                setSelected(s);
                setPin('');
              }}
              className="flex w-full flex-col items-center gap-2 rounded-2xl border border-zinc-200 bg-white p-4 text-center transition hover:border-brand-500 active:scale-[.98] dark:border-zinc-800 dark:bg-zinc-900"
            >
              <span className="grid size-14 place-items-center rounded-full bg-zinc-100 text-2xl font-bold dark:bg-zinc-800">
                {s.name.slice(0, 1).toUpperCase()}
              </span>
              <span className="line-clamp-2 font-semibold leading-tight">{s.name}</span>
              <span className="text-xs text-zinc-500">{ROLE_LABELS[s.role] ?? s.role}</span>
            </button>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <form ref={formRef} action={action} className="mx-auto w-full max-w-xs space-y-5">
      <input type="hidden" name="profile_id" value={selected.id} />
      <input type="hidden" name="pin" value={pin} />
      <button type="button" onClick={() => setSelected(null)} className="flex items-center gap-1 text-sm text-zinc-500 hover:underline">
        <ArrowLeft className="size-4" /> Cambiar de persona
      </button>
      <div className="text-center">
        <p className="text-xl font-bold">{selected.name}</p>
        <p className="text-sm text-zinc-500">Marca tu PIN</p>
      </div>
      <div className="flex justify-center gap-3" aria-label={`${pin.length} dígitos marcados`}>
        {Array.from({ length: Math.max(4, pin.length) }, (_, i) => (
          <span key={i} className={cn('size-4 rounded-full border-2 border-zinc-400', i < pin.length && 'border-brand-500 bg-brand-500')} />
        ))}
      </div>
      <p role="alert" className="min-h-5 text-center text-sm font-medium text-red-600">
        {state?.error}
      </p>
      <div className="grid grid-cols-3 gap-3">
        {KEYS.map((k) => (
          <PadKey key={k} onClick={() => press(k)}>
            {k}
          </PadKey>
        ))}
        <PadKey onClick={() => setPin((p) => p.slice(0, -1))} label="Borrar">
          <Delete className="mx-auto size-6" />
        </PadKey>
        <PadKey onClick={() => press('0')}>0</PadKey>
        <button
          type="submit"
          disabled={pin.length < 4 || pending}
          className="h-16 rounded-2xl bg-brand-500 text-lg font-bold text-zinc-950 transition disabled:bg-zinc-200 disabled:text-zinc-400 dark:disabled:bg-zinc-800"
        >
          {pending ? '…' : 'Entrar'}
        </button>
      </div>
    </form>
  );
}

function PadKey({ children, onClick, label }: { children: React.ReactNode; onClick: () => void; label?: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="h-16 rounded-2xl bg-zinc-100 text-2xl font-semibold transition active:scale-95 active:bg-zinc-200 dark:bg-zinc-800 dark:active:bg-zinc-700"
    >
      {children}
    </button>
  );
}
