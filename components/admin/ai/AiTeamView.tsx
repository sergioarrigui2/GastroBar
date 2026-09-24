import { BrainCircuit, CalendarClock, ChefHat, ShieldAlert, ShoppingCart, Sparkles } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { HEALTH_BADGE, HEALTH_LABEL } from '@/components/admin/analytics/ReportView';
import { Badge, Card } from '@/components/ui/primitives';
import type { AiTeamOverview } from '@/lib/services/ai-team';
import { cn, formatCurrency } from '@/lib/utils';

const usd = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(n);

function AgentCard({
  icon,
  name,
  role,
  status,
  statusTone,
  cost,
  children,
  href,
  cta,
}: {
  icon: ReactNode;
  name: string;
  role: string;
  status: string;
  statusTone: 'active' | 'free' | 'soon';
  cost: string;
  children?: ReactNode;
  href?: string;
  cta?: string;
}) {
  return (
    <Card className={cn('flex flex-col gap-3', statusTone === 'soon' && 'opacity-75')}>
      <div className="flex items-start gap-3">
        <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-brand-100 text-brand-600 dark:bg-brand-500/15">{icon}</div>
        <div className="min-w-0 flex-1">
          <p className="font-bold">{name}</p>
          <p className="text-sm text-zinc-500">{role}</p>
        </div>
        <Badge
          className={cn(
            statusTone === 'active' && 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200',
            statusTone === 'free' && 'bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-200',
            statusTone === 'soon' && 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300',
          )}
        >
          {status}
        </Badge>
      </div>
      {children && <div className="text-sm">{children}</div>}
      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-zinc-100 pt-3 text-xs text-zinc-500 dark:border-zinc-800">
        <span>{cost}</span>
        {href && cta && (
          <Link href={href} className="font-semibold text-brand-600 hover:underline">
            {cta} →
          </Link>
        )}
      </div>
    </Card>
  );
}

export function AiTeamView({
  overview: o,
  tenant,
}: {
  overview: AiTeamOverview;
  tenant: { currency: string; locale: string; timezone: string };
}) {
  const { quota } = o;
  const money = (n: number) => formatCurrency(n, tenant.currency, tenant.locale);
  const month = new Intl.DateTimeFormat(tenant.locale, { timeZone: tenant.timezone, month: 'long' }).format(new Date());
  const reportsPct = quota.plan.reportsPerMonth > 0 ? Math.min(100, (quota.reportsUsed / quota.plan.reportsPerMonth) * 100) : 100;
  const budgetPct = quota.plan.monthlyBudgetUsd > 0 ? Math.min(100, (quota.spentUsd / quota.plan.monthlyBudgetUsd) * 100) : 100;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <Sparkles className="size-6 text-brand-600" aria-hidden /> Tu equipo IA
        </h1>
        <p className="text-sm text-zinc-500">
          Agentes que revisan tu negocio y te dicen dónde se va la plata. Las cifras las calcula el sistema; la IA sólo se usa cuando
          hace falta interpretar.
        </p>
      </div>

      <section className="grid gap-4 lg:grid-cols-5">
        <Card className="space-y-4 lg:col-span-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Plata detectada en {month}</p>
            <p className="text-4xl font-extrabold tabular-nums text-brand-600">{money(o.detected.total)}</p>
            <p className="text-sm text-zinc-500">
              En fugas y sobrecostos que tus agentes pusieron a la vista este mes · la IA costó <b>{usd(quota.spentUsd)}</b>
            </p>
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
            descuentos por persona), nunca con estimaciones de la IA.
          </p>
        </Card>

        <Card className="space-y-4 lg:col-span-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Tu plan</p>
            <Badge className="bg-brand-100 text-brand-600 dark:bg-brand-500/15">{quota.plan.label}</Badge>
          </div>
          <div className="space-y-1.5">
            <div className="flex justify-between text-sm">
              <span>Informes del Analista este mes</span>
              <span className="font-semibold tabular-nums">
                {quota.reportsUsed} / {quota.plan.reportsPerMonth}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
              <div className={cn('h-full rounded-full', reportsPct >= 100 ? 'bg-red-500' : 'bg-brand-500')} style={{ width: `${reportsPct}%` }} />
            </div>
          </div>
          <div className="space-y-1.5">
            <div className="flex justify-between text-sm">
              <span>Gasto de IA este mes</span>
              <span className="font-semibold tabular-nums">
                {usd(quota.spentUsd)} / {usd(quota.plan.monthlyBudgetUsd)}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
              <div className={cn('h-full rounded-full', budgetPct >= 100 ? 'bg-red-500' : 'bg-emerald-500')} style={{ width: `${budgetPct}%` }} />
            </div>
          </div>
          {quota.blockedReason ? (
            <p className="rounded-xl bg-amber-100 p-3 text-sm text-amber-900 dark:bg-amber-500/15 dark:text-amber-200">
              {quota.blockedReason} El tablero, las alertas y la plata detectada siguen funcionando porque no usan IA.
            </p>
          ) : (
            <p className="text-sm text-zinc-500">
              Te quedan <b>{quota.reportsLeft}</b> informe(s). Si los datos no cambian, repetir un informe no consume cupo.
            </p>
          )}
          <p className="text-xs text-zinc-500">
            Para ampliar tu plan, escríbele al administrador de la plataforma. El detalle de cada llamada está en{' '}
            <Link href="/admin/ai-usage" className="font-semibold text-brand-600 hover:underline">
              Consumo IA
            </Link>
            .
          </p>
        </Card>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-bold">Agentes</h2>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <AgentCard
            icon={<BrainCircuit className="size-6" />}
            name="Analista"
            role="Revisa ventas, menú, equipo, caja e inventario y te dice qué hacer."
            status={o.configured ? 'Activo' : 'Sin configurar'}
            statusTone={o.configured ? 'active' : 'soon'}
            cost="Usa IA · cuenta del cupo del plan"
            href="/admin/analytics"
            cta={o.latestReport ? 'Ver informe' : 'Generar primer informe'}
          >
            {o.latestReport ? (
              <div className="space-y-1">
                <Badge className={HEALTH_BADGE[o.latestReport.content.health]}>{HEALTH_LABEL[o.latestReport.content.health]}</Badge>
                <p className="font-medium">{o.latestReport.content.headline}</p>
                <p className="text-xs text-zinc-500">
                  {o.latestReport.created_label} · {o.latestReport.content.findings.length} hallazgo(s)
                </p>
              </div>
            ) : (
              <p className="text-zinc-500">Aún no ha hecho su primer informe.</p>
            )}
          </AgentCard>

          <AgentCard
            icon={<ShieldAlert className="size-6" />}
            name="Vigía"
            role="Vigila caja, faltantes de inventario, descuentos, anulaciones y demoras todo el tiempo."
            status="Activo · sin costo"
            statusTone="free"
            cost="Reglas estadísticas · no usa IA"
            href="/admin/analytics"
            cta="Ver alertas"
          >
            <p className="text-zinc-500">Sus alertas alimentan el resumen diario y la plata detectada.</p>
          </AgentCard>

          <AgentCard
            icon={<ChefHat className="size-6" />}
            name="Ingeniero de menú"
            role="Clasifica cada producto en estrella, caballo de batalla, enigma o perro según ventas y margen real."
            status="Activo · sin costo"
            statusTone="free"
            cost="Cálculo exacto · no usa IA"
            href="/admin/analytics"
            cta="Ver clasificación"
          />

          <AgentCard
            icon={<ShoppingCart className="size-6" />}
            name="Comprador"
            role="Arma tu pedido de compras según lo que vas a vender, a la hora que tú programes."
            status="Próximamente"
            statusTone="soon"
            cost="Cálculo exacto + IA sólo para redactar el pedido"
          />

          <AgentCard
            icon={<CalendarClock className="size-6" />}
            name="Mensajero"
            role="Te envía el resumen semanal por WhatsApp o correo el lunes a primera hora."
            status="Próximamente"
            statusTone="soon"
            cost="Reutiliza el último informe · no gasta cupo"
          />
        </div>
      </section>
    </div>
  );
}
