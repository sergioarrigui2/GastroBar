import { AlertOctagon, AlertTriangle, BrainCircuit, Lightbulb, ShieldAlert, Sparkles } from 'lucide-react';
import Link from 'next/link';
import type { DailyBriefing } from '@/lib/services/ai-team';
import { cn } from '@/lib/utils';

const ICON = {
  critical: { icon: AlertOctagon, className: 'text-red-600' },
  warning: { icon: AlertTriangle, className: 'text-amber-600' },
  info: { icon: Lightbulb, className: 'text-sky-600' },
} as const;

/** Portada del admin: "3 cosas para hoy" sin llamar al modelo. */
export function DailyBriefingCard({ briefing, name }: { briefing: DailyBriefing; name: string }) {
  const firstName = name.split(' ')[0] ?? name;
  return (
    <section className="mb-5 rounded-2xl border border-brand-400/40 bg-gradient-to-br from-brand-50 to-white p-4 dark:from-brand-500/10 dark:to-zinc-900">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Sparkles className="size-5 text-brand-600" aria-hidden />
        <h2 className="mr-auto font-bold">
          {briefing.greeting}, {firstName}.{' '}
          {briefing.items.length > 0 ? `${briefing.items.length === 1 ? 'Una cosa' : `${briefing.items.length} cosas`} para hoy` : 'Todo en orden'}
        </h2>
        <Link href="/admin/ai" className="text-sm font-semibold text-brand-600 hover:underline">
          Tu equipo IA →
        </Link>
      </div>
      {briefing.items.length === 0 ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Tus agentes no ven nada fuera de lo normal en los últimos 7 días. Siguen vigilando caja, inventario, costos y equipo.
        </p>
      ) : (
        <ol className="grid gap-3 md:grid-cols-3">
          {briefing.items.map((item, i) => {
            const meta = ICON[item.severity];
            const Icon = meta.icon;
            return (
              <li key={i} className="flex gap-2 rounded-xl bg-white/80 p-3 dark:bg-zinc-900/60">
                <Icon className={cn('mt-0.5 size-5 shrink-0', meta.className)} aria-hidden />
                <div className="min-w-0 space-y-1">
                  <p className="text-sm font-semibold">{item.title}</p>
                  <p className="text-sm text-zinc-600 dark:text-zinc-400">{item.action}</p>
                  <p className="flex items-center gap-1 text-xs text-zinc-500">
                    {item.source === 'analista' ? (
                      <>
                        <BrainCircuit className="size-3.5" aria-hidden /> Analista
                      </>
                    ) : (
                      <>
                        <ShieldAlert className="size-3.5" aria-hidden /> Vigía
                      </>
                    )}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
