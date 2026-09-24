import { Lock, MessageCircle } from 'lucide-react';
import Link from 'next/link';
import { AGENTS, type AgentId } from '@/lib/ai/agents';
import { cn } from '@/lib/utils';
import { AgentAvatar } from './AgentAvatar';

/** Enlace a la línea de ventas (NEXT_PUBLIC_SALES_WHATSAPP) con un mensaje listo. */
export function salesLink(text: string): string | null {
  const phone = (process.env.NEXT_PUBLIC_SALES_WHATSAPP ?? '').replace(/\D/g, '');
  return phone.length >= 8 ? `https://wa.me/${phone}?text=${encodeURIComponent(text)}` : null;
}

/**
 * Lo que se ve en lugar de un agente no contratado: su presentación corta y una
 * invitación a activarlo. Nunca muestra precios ni costos.
 */
export function AgentLocked({ agent, hint, compact = false }: { agent: AgentId; hint?: string; compact?: boolean }) {
  const a = AGENTS[agent];
  const wa = salesLink(`Hola, quiero activar al ${a.name} en mi GastroBar.`);
  return (
    <div
      className={cn(
        'rounded-2xl border border-dashed border-zinc-300 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900/60',
        compact ? 'p-3' : 'p-5',
      )}
    >
      <div className="flex flex-wrap items-start gap-3">
        <AgentAvatar agent={agent} size={compact ? 'sm' : 'md'} />
        <div className="min-w-0 flex-1 space-y-1">
          <p className="flex items-center gap-1.5 font-semibold">
            <Lock className="size-3.5 text-zinc-400" aria-hidden /> {a.name} no está en tu equipo
          </p>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">{hint ?? a.tagline}</p>
          {!compact && <p className="text-sm text-zinc-500">{a.value[0]}</p>}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Link
          href={`/admin/ai/${agent}`}
          className="inline-flex h-9 items-center rounded-lg px-3 text-sm font-semibold text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
        >
          Conocer al {a.name}
        </Link>
        {wa ? (
          <a
            href={wa}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-sm font-semibold text-white hover:bg-emerald-700"
          >
            <MessageCircle className="size-4" /> Activarlo con mi asesor
          </a>
        ) : (
          <span className="self-center text-xs text-zinc-500">Pídele a tu asesor de GastroBar que lo active.</span>
        )}
      </div>
    </div>
  );
}
