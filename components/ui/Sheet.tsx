'use client';

import { X } from 'lucide-react';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Bottom sheet en móvil (alcanzable con el pulgar) y diálogo centrado en
 * pantallas grandes. Usa <dialog> nativo: foco atrapado, Escape y backdrop.
 */
export function Sheet({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className={cn(
        'fixed inset-x-0 bottom-0 top-auto m-0 max-h-[92dvh] w-full max-w-none overflow-hidden rounded-t-3xl bg-white p-0 text-zinc-900 shadow-2xl backdrop:bg-black/50 backdrop:backdrop-blur-sm open:animate-slide-up dark:bg-zinc-900 dark:text-zinc-100',
        'sm:inset-0 sm:m-auto sm:max-h-[85dvh] sm:max-w-lg sm:rounded-3xl',
        className,
      )}
    >
      {open && (
        <div className="flex max-h-[inherit] flex-col">
          <div className="mx-auto mt-2 h-1.5 w-12 rounded-full bg-zinc-300 sm:hidden dark:bg-zinc-700" aria-hidden />
          <header className="flex items-start gap-3 px-5 pb-3 pt-3">
            <div className="min-w-0 flex-1">
              <h2 id={titleId} className="truncate text-lg font-bold">
                {title}
              </h2>
              {subtitle && <p className="text-sm text-zinc-500 dark:text-zinc-400">{subtitle}</p>}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Cerrar"
              className="-mr-2 grid size-10 place-items-center rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              <X className="size-5" />
            </button>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">{children}</div>
          {footer && (
            <footer className="pb-safe border-t border-zinc-200 px-5 pt-3 dark:border-zinc-800">{footer}</footer>
          )}
        </div>
      )}
    </dialog>
  );
}
