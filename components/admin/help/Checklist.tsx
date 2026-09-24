'use client';

import { useEffect, useState, type ReactNode } from 'react';

export type ChecklistGroup = { title: string; items: Array<{ id: string; label: ReactNode }> };

/** Lista de verificación de la prueba guiada; el avance se recuerda en este navegador. */
export function Checklist({ storageKey, groups }: { storageKey: string; groups: ChecklistGroup[] }) {
  const [checked, setChecked] = useState<Record<string, boolean>>({});

  useEffect(() => {
    try {
      setChecked(JSON.parse(localStorage.getItem(storageKey) ?? '{}') as Record<string, boolean>);
    } catch {
      // Sin almacenamiento disponible: la lista funciona igual, sólo que no recuerda el avance.
    }
  }, [storageKey]);

  const toggle = (id: string) =>
    setChecked((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      try {
        localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        // Ignorado: ver arriba.
      }
      return next;
    });

  const all = groups.flatMap((g) => g.items);
  const done = all.filter((i) => checked[i.id]).length;

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3 text-sm text-zinc-500">
        <div className="h-2 w-48 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
          <div className="h-full bg-brand-600 transition-all" style={{ width: `${all.length ? (done / all.length) * 100 : 0}%` }} />
        </div>
        <span className="tabular-nums">
          {done} de {all.length}
        </span>
        {done > 0 && (
          <button
            type="button"
            onClick={() => {
              setChecked({});
              try {
                localStorage.removeItem(storageKey);
              } catch {
                // Ignorado.
              }
            }}
            className="ml-auto text-xs font-medium hover:text-zinc-900 hover:underline dark:hover:text-zinc-100"
          >
            Reiniciar
          </button>
        )}
      </div>
      {groups.map((group) => (
        <div key={group.title}>
          <h3 className="mb-2 font-semibold">{group.title}</h3>
          <ul className="space-y-2">
            {group.items.map((item) => (
              <li key={item.id}>
                <label className="flex cursor-pointer items-start gap-3 rounded-xl px-2 py-1.5 hover:bg-zinc-50 dark:hover:bg-zinc-800/60">
                  <input
                    type="checkbox"
                    checked={Boolean(checked[item.id])}
                    onChange={() => toggle(item.id)}
                    className="mt-1 size-5 shrink-0 accent-brand-600"
                  />
                  <span className={checked[item.id] ? 'text-zinc-400 line-through decoration-zinc-300 dark:decoration-zinc-600' : ''}>
                    {item.label}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
