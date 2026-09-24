import { Sparkles } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { HEALTH_BADGE, HEALTH_LABEL } from '@/components/admin/analytics/ReportView';
import { Badge, Card } from '@/components/ui/primitives';
import { AGENT_STATUS_LABEL } from '@/lib/ai/access';
import { AGENT_ORDER, AGENTS, type AgentId } from '@/lib/ai/agents';
import type { AiTeamOverview } from '@/lib/services/ai-team';
import { cn, formatCurrency } from '@/lib/utils';
import { AgentAvatar } from './AgentAvatar';
import { AgentLocked } from './AgentLocked';

/** Dónde trabaja cada agente (enlace principal de su tarjeta). */
const WORKPLACE: Record<AgentId, { href: string; cta: string }> = {
  vigia: { href: '/admin/analytics', cta: 'Ver alertas' },
  ingeniero: { href: '/admin/menu', cta: 'Ver mi carta' },
  analista: { href: '/admin/analytics', cta: 'Ver informe' },
  comprador: { href: '/admin/purchasing', cta: 'Ver pedido' },
  mensajero: { href: '/admin/ai/mensajero', cta: 'Configurar' },
};

export function AiTeamView({
  overview: o,
  tenant,
}: {
  overview: AiTeamOverview;
  tenant: { currency: string; locale: string; timezone: string };
}) {
  const { quota, access } = o;
  const money = (n: number) => formatCurrency(n, tenant.currency, tenant.locale);
  const month = new Intl.DateTimeFormat(tenant.locale, { timeZone: tenant.timezone, month: 'long' }).format(new Date());
  const fmtDay = (iso: string) => new Intl.DateTimeFormat(tenant.locale, { timeZone: tenant.timezone, day: 'numeric', month: 'long' }).format(new Date(iso));
  const hired = AGENT_ORDER.filter((a) => access[a].active);
  const reportsPct = quota.plan.reportsPerMonth > 0 ? Math.min(100, (quota.reportsUsed / quota.plan.reportsPerMonth) * 100) : 100;

  const body: Partial<Record<AgentId, ReactNode>> = {
    analista: o.latestReport ? (
      <div className="space-y-1">
        <Badge className={HEALTH_BADGE[o.latestReport.content.health]}>{HEALTH_LABEL[o.latestReport.content.health]}</Badge>
        <p className="font-medium">{o.latestReport.content.headline}</p>
        <p className="text-xs text-zinc-500">
          {o.latestReport.created_label} · {quota.reportsLeft} de {quota.plan.reportsPerMonth} informes disponibles este mes
        </p>
      </div>
    ) : (
      <p className="text-zinc-500">Aún no ha hecho su primer informe. Tienes {quota.reportsLeft} disponibles este mes.</p>
    ),
    comprador: o.purchase.latest ? (
      <div className="space-y-1">
        <p className="font-medium">
          {o.purchase.latest.status === 'draft' ? 'Pedido listo por enviar' : 'Último pedido'}: {o.purchase.latest.lines} insumo(s) ·{' '}
          {money(o.purchase.latest.total)}
        </p>
        {o.purchase.latest.urgent > 0 && o.purchase.latest.status === 'draft' && (
          <p className="text-xs font-semibold text-red-600">{o.purchase.latest.urgent} insumo(s) urgente(s)</p>
        )}
        {o.purchase.nextRunAt && <p className="text-xs text-zinc-500">Próximo pedido automático: {fmtDay(o.purchase.nextRunAt)}</p>}
      </div>
    ) : (
      <p className="text-zinc-500">Aún no ha calculado ningún pedido.</p>
    ),
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <Sparkles className="size-6 text-brand-600" aria-hidden /> Tu equipo IA
        </h1>
        <p className="text-sm text-zinc-500">
          Agentes que revisan tu negocio todos los días y te dicen dónde se va la plata. Tienes {hired.length} de {AGENT_ORDER.length} en tu
          equipo.
        </p>
      </div>

      <section className="grid gap-4 lg:grid-cols-5">
        {access.vigia.active ? (
          <Card className="space-y-4 lg:col-span-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Plata detectada en {month}</p>
              <p className="text-4xl font-extrabold tabular-nums text-brand-600">{money(o.detected.total)}</p>
              <p className="text-sm text-zinc-500">En fugas y sobrecostos que tus agentes pusieron a la vista este mes.</p>
            </div>
            {o.detected.items.length === 0 ? (
              <p className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-200">
                Sin fugas detectadas este mes. Tus agentes siguen vigilando caja, inventario, costos y descuentos.
              </p>
            ) : (
              <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {o.detected.items.map((i) => (
                  <li key={i.key} className="flex items-start justify-between gap-4 py-2 text-sm">
                    <div className="min-w-0">
                      <p className="font-medium">{i.label}</p>
                      <p className="text-xs text-zinc-500">{i.detail}</p>
                    </div>
                    <span className="shrink-0 font-semibold tabular-nums">{money(i.amount)}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-zinc-500">
              Calculado sólo con datos exactos del sistema (cierres de caja, conteos de inventario, mermas, costo real por receta y
              descuentos por persona).
            </p>
          </Card>
        ) : (
          <div className="lg:col-span-3">
            <AgentLocked agent="vigia" hint="Con el Vigía verías aquí cuánta plata se te escapa cada mes en caja, inventario y descuentos." />
          </div>
        )}

        <Card className="space-y-4 lg:col-span-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Tu equipo</p>
          <ul className="space-y-2">
            {AGENT_ORDER.map((a) => (
              <li key={a} className="flex items-center gap-2 text-sm">
                <AgentAvatar agent={a} size="sm" />
                <Link href={`/admin/ai/${a}`} className="mr-auto font-medium hover:underline">
                  {AGENTS[a].name}
                </Link>
                <span
                  className={cn(
                    'text-xs font-semibold',
                    access[a].status === 'contracted' && 'text-emerald-600',
                    access[a].status === 'trial' && 'text-sky-600',
                    access[a].status === 'off' && 'text-zinc-400',
                  )}
                >
                  {access[a].status === 'trial' && access[a].trialUntil
                    ? `En prueba hasta el ${fmtDay(access[a].trialUntil!)}`
                    : AGENT_STATUS_LABEL[access[a].status]}
                </span>
              </li>
            ))}
          </ul>
          {access.analista.active && (
            <div className="space-y-1.5 border-t border-zinc-100 pt-3 dark:border-zinc-800">
              <div className="flex justify-between text-sm">
                <span>Informes del Analista incluidos</span>
                <span className="font-semibold tabular-nums">
                  {quota.reportsUsed} / {quota.plan.reportsPerMonth}
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                <div className={cn('h-full rounded-full', reportsPct >= 100 ? 'bg-amber-500' : 'bg-brand-500')} style={{ width: `${reportsPct}%` }} />
              </div>
              <p className="text-xs text-zinc-500">
                {quota.blockedReason ?? 'Si tus datos no cambian, repetir un informe no gasta cupo.'} Se renueva cada mes.
              </p>
            </div>
          )}
        </Card>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-bold">Agentes</h2>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {AGENT_ORDER.map((a) =>
            access[a].active ? (
              <Card key={a} className="flex flex-col gap-3">
                <div className="flex items-start gap-3">
                  <AgentAvatar agent={a} />
                  <div className="min-w-0 flex-1">
                    <Link href={`/admin/ai/${a}`} className="font-bold hover:underline">
                      {AGENTS[a].name}
                    </Link>
                    <p className="text-sm text-zinc-500">{AGENTS[a].tagline}</p>
                  </div>
                  <Badge
                    className={
                      access[a].status === 'trial'
                        ? 'bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-200'
                        : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200'
                    }
                  >
                    {AGENT_STATUS_LABEL[access[a].status]}
                  </Badge>
                </div>
                {body[a] && <div className="text-sm">{body[a]}</div>}
                <div className="mt-auto flex flex-wrap items-center justify-end gap-3 border-t border-zinc-100 pt-3 text-xs dark:border-zinc-800">
                  <Link href={`/admin/ai/${a}`} className="font-semibold text-zinc-600 hover:underline dark:text-zinc-300">
                    Conóceme
                  </Link>
                  <Link href={WORKPLACE[a].href} className="font-semibold text-brand-600 hover:underline">
                    {WORKPLACE[a].cta} →
                  </Link>
                </div>
              </Card>
            ) : (
              <AgentLocked key={a} agent={a} />
            ),
          )}
        </div>
      </section>
    </div>
  );
}
