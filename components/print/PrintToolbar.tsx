'use client';

import { Printer, X } from 'lucide-react';
import { useEffect } from 'react';

/** Barra de acciones (no se imprime). Con autoPrint abre el diálogo de impresión al cargar. */
export function PrintToolbar({ autoPrint }: { autoPrint: boolean }) {
  useEffect(() => {
    if (!autoPrint) return;
    const t = setTimeout(() => window.print(), 300);
    return () => clearTimeout(t);
  }, [autoPrint]);

  return (
    <div className="no-print mx-auto mb-4 flex w-[72mm] gap-2">
      <button
        type="button"
        onClick={() => window.print()}
        className="flex h-10 flex-1 items-center justify-center gap-2 rounded-xl bg-zinc-900 text-sm font-semibold text-white"
      >
        <Printer className="size-4" /> Imprimir
      </button>
      <button
        type="button"
        onClick={() => window.close()}
        aria-label="Cerrar"
        className="grid size-10 place-items-center rounded-xl bg-white text-zinc-700"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
