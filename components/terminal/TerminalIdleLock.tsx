'use client';

import { Lock } from 'lucide-react';
import { useEffect } from 'react';
import { lockTerminalAction } from '@/app/actions/terminal';

const IDLE_MS = 3 * 60_000;
const EVENTS = ['pointerdown', 'keydown', 'scroll', 'touchstart'] as const;

/**
 * En una terminal compartida: tras 3 minutos sin tocar la pantalla vuelve a la
 * pantalla de PIN, para que el siguiente no venda a nombre del anterior.
 * `showButton` agrega un botón flotante de "Cambiar usuario" donde la vista no tiene uno propio.
 */
export function TerminalIdleLock({ showButton = false }: { showButton?: boolean }) {
  useEffect(() => {
    let timer = window.setTimeout(lock, IDLE_MS);
    function lock() {
      void lockTerminalAction();
    }
    const reset = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(lock, IDLE_MS);
    };
    for (const e of EVENTS) window.addEventListener(e, reset, { passive: true });
    return () => {
      window.clearTimeout(timer);
      for (const e of EVENTS) window.removeEventListener(e, reset);
    };
  }, []);

  if (!showButton) return null;
  return (
    <form action={lockTerminalAction} className="fixed bottom-[calc(1rem+env(safe-area-inset-bottom,0px))] left-4 z-40">
      <button
        type="submit"
        className="flex items-center gap-2 rounded-full bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white shadow-lg dark:bg-zinc-100 dark:text-zinc-900"
      >
        <Lock className="size-4" /> Cambiar usuario
      </button>
    </form>
  );
}
