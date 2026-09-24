import { ArrowLeft, CheckCircle2, Cog, Gem, MapPin, Wallet } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Card } from '@/components/ui/primitives';
import type { AgentProfile } from '@/lib/ai/agents';
import type { AgentStat } from '@/lib/services/agent-stats';
import { cn } from '@/lib/utils';
import { AgentAvatar } from './AgentAvatar';

function Section({ icon, title, items }: { icon: ReactNode; title: string; items: string[] }) {
  return (
    <Card className="space-y-3">
      <h2 className="flex items-center gap-2 font-semibold">
        {icon} {title}
      </h2>
      <ul className="space-y-2 text-sm leading-relaxed">
        {items.map((item, i) => (
          <li key={i} className="flex gap-2">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** Presentación de un agente: quién es, qué hace, cómo trabaja, qué gana el negocio y su trabajo real del mes. */
export function AgentProfileView({ agent, stats, children }: { agent: AgentProfile; stats: AgentStat[]; children?: ReactNode }) {
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <Link href="/admin/ai" className="inline-flex items-center gap-1 text-sm font-medium text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
        <ArrowLeft className="size-4" /> Tu equipo IA
      </Link>

      <header className="flex flex-col gap-5 sm:flex-row sm:items-start">
        <AgentAvatar agent={agent.id} size="lg" />
        <div className="min-w-0 flex-1 space-y-3">
          <div>
            <h1 className="text-3xl font-extrabold">{agent.name}</h1>
            <p className="text-zinc-500">{agent.tagline}</p>
          </div>
          <blockquote className={cn('relative rounded-2xl rounded-tl-none p-4 text-base leading-relaxed', agent.tone)}>
            “{agent.intro}”
          </blockquote>
        </div>
      </header>

      <section aria-label="Mi trabajo este mes">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500">Mi trabajo este mes</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {stats.map((s) => (
            <Card key={s.label} className="space-y-1">
              <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">{s.label}</p>
              <p className="text-xl font-bold tabular-nums">{s.value}</p>
              {s.hint && <p className="text-xs text-zinc-500">{s.hint}</p>}
            </Card>
          ))}
        </div>
      </section>

      {children}

      <div className="grid gap-4 lg:grid-cols-3">
        <Section icon={<Cog className="size-5 text-zinc-400" aria-hidden />} title="Qué hago" items={agent.does} />
        <Section icon={<Gem className="size-5 text-brand-600" aria-hidden />} title="Qué gana tu negocio" items={agent.value} />
        <Section icon={<Cog className="size-5 text-zinc-400" aria-hidden />} title="Cómo trabajo" items={agent.how} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card className="space-y-2">
          <h2 className="flex items-center gap-2 font-semibold">
            <Wallet className="size-5 text-zinc-400" aria-hidden /> Cuánto cuesto
          </h2>
          <p
            className={cn(
              'inline-block rounded-full px-3 py-1 text-sm font-bold',
              agent.cost.usesAi === 'yes'
                ? 'bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-200'
                : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200',
            )}
          >
            {agent.cost.label}
          </p>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">{agent.cost.detail}</p>
        </Card>
        <Card className="space-y-2">
          <h2 className="flex items-center gap-2 font-semibold">
            <MapPin className="size-5 text-zinc-400" aria-hidden /> Dónde me encuentras
          </h2>
          <ul className="flex flex-wrap gap-2">
            {agent.where.map((w) => (
              <li key={w.href + w.label}>
                <Link
                  href={w.href}
                  className="inline-flex rounded-full border border-zinc-200 px-3 py-1 text-sm font-medium hover:border-brand-400 hover:text-brand-600 dark:border-zinc-700"
                >
                  {w.label}
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
