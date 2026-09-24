import { BrainCircuit, ChefHat, Send, ShieldAlert, ShoppingCart } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { AGENTS, type AgentId } from '@/lib/ai/agents';
import { cn } from '@/lib/utils';

const ICONS = { vigia: ShieldAlert, ingeniero: ChefHat, analista: BrainCircuit, comprador: ShoppingCart, mensajero: Send } as const;

export function AgentAvatar({ agent, size = 'md' }: { agent: AgentId; size?: 'sm' | 'md' | 'lg' }) {
  const Icon = ICONS[agent];
  return (
    <span
      className={cn(
        'grid shrink-0 place-items-center rounded-xl',
        AGENTS[agent].tone,
        size === 'sm' && 'size-6 rounded-lg',
        size === 'md' && 'size-11',
        size === 'lg' && 'size-16 rounded-2xl',
      )}
      aria-hidden
    >
      <Icon className={cn(size === 'sm' ? 'size-3.5' : size === 'md' ? 'size-6' : 'size-8')} />
    </span>
  );
}

/** Firma pequeña de un agente que enlaza a su presentación. */
export function AgentChip({ agent, label }: { agent: AgentId; label?: string }) {
  return (
    <Link href={`/admin/ai/${agent}`} className="inline-flex items-center gap-1.5 text-xs font-semibold hover:underline">
      <AgentAvatar agent={agent} size="sm" />
      {label ?? AGENTS[agent].name}
    </Link>
  );
}

export type NoticeItem = { title: string; detail?: string; severity: 'critical' | 'warning' | 'info' };

/**
 * Aviso de un agente dentro de un módulo (Menú, Inventario, Caja, Personal).
 * Se muestra sólo si el agente tiene algo que decir.
 */
export function AgentNotice({
  agent,
  headline,
  items,
  action,
}: {
  agent: AgentId;
  headline: string;
  items: NoticeItem[];
  action?: ReactNode;
}) {
  if (items.length === 0) return null;
  const worst = items.some((i) => i.severity === 'critical') ? 'critical' : items.some((i) => i.severity === 'warning') ? 'warning' : 'info';
  return (
    <aside
      className={cn(
        'mb-5 rounded-2xl border p-4',
        worst === 'critical' && 'border-red-300 bg-red-50 dark:border-red-500/30 dark:bg-red-500/10',
        worst === 'warning' && 'border-amber-300 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-500/10',
        worst === 'info' && 'border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900',
      )}
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <AgentAvatar agent={agent} size="sm" />
        <p className="mr-auto text-sm font-semibold">
          {AGENTS[agent].name}: {headline}
        </p>
        {action}
        <Link href={`/admin/ai/${agent}`} className="text-xs font-medium text-zinc-500 hover:underline">
          ¿Quién es el {AGENTS[agent].name}?
        </Link>
      </div>
      <ul className="space-y-1 text-sm">
        {items.slice(0, 5).map((i, n) => (
          <li key={n} className="flex gap-2">
            <span
              className={cn(
                'mt-1.5 size-2 shrink-0 rounded-full',
                i.severity === 'critical' ? 'bg-red-500' : i.severity === 'warning' ? 'bg-amber-500' : 'bg-sky-500',
              )}
              aria-hidden
            />
            <span>
              <b className="font-medium">{i.title}</b>
              {i.detail && <span className="text-zinc-600 dark:text-zinc-400"> · {i.detail}</span>}
            </span>
          </li>
        ))}
      </ul>
    </aside>
  );
}
