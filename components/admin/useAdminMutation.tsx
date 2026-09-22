'use client';

import { CheckCircle2, XCircle } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, useTransition } from 'react';
import { cn } from '@/lib/utils';
import type { ActionResult } from '@/types/domain';

type Flash = { ok: boolean; text: string } | null;

/**
 * Ejecuta una Server Action de administración, muestra el resultado y refresca
 * los datos del servidor al terminar con éxito.
 */
export function useAdminMutation() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [flash, setFlash] = useState<Flash>(null);

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), flash.ok ? 2500 : 6000);
    return () => clearTimeout(t);
  }, [flash]);

  const run = useCallback(
    <T,>(action: () => Promise<ActionResult<T>>, successText: string, onSuccess?: (data: T) => void) => {
      startTransition(async () => {
        const result = await action();
        if (result.ok) {
          setFlash({ ok: true, text: successText });
          onSuccess?.(result.data);
          router.refresh();
        } else {
          setFlash({ ok: false, text: result.error });
        }
      });
    },
    [router],
  );

  return { pending, flash, run, clearFlash: () => setFlash(null) };
}

export function FlashMessage({ flash }: { flash: Flash }) {
  if (!flash) return null;
  const Icon = flash.ok ? CheckCircle2 : XCircle;
  return (
    <div
      role={flash.ok ? 'status' : 'alert'}
      className={cn(
        'fixed inset-x-4 bottom-4 z-[60] mx-auto flex max-w-md animate-pop items-start gap-2 rounded-2xl px-4 py-3 text-sm font-semibold shadow-lg',
        flash.ok ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900' : 'bg-red-600 text-white',
      )}
    >
      <Icon className="mt-0.5 size-4 shrink-0" />
      <span>{flash.text}</span>
    </div>
  );
}

/** Convierte el texto de un input numérico (acepta coma decimal) en número. */
export function toNumber(value: string): number {
  const n = Number(value.replace(',', '.').trim());
  return Number.isFinite(n) ? n : NaN;
}
