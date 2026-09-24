import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { CreateTenantForm } from '@/components/platform/CreateTenantForm';
import { AgentAvatar } from '@/components/admin/ai/AgentAvatar';
import { Badge, Card } from '@/components/ui/primitives';
import { listTenants, PLAN_OPTIONS } from '@/lib/platform/service';
import { cn } from '@/lib/utils';

export const metadata = { title: 'Clientes' };

const usd = (n: number) => `USD ${n.toFixed(n < 1 ? 3 : 2)}`;

export default async function PlatformHome() {
  const tenants = await listTenants();
  const active = tenants.filter((t) => t.status === 'active');
  const totalAgents = active.reduce((s, t) => s + t.activeAgents.length, 0);
  const aiCost = tenants.reduce((s, t) => s + t.aiCostMonth, 0);
  const trials = active.filter((t) => t.trialAgents.length > 0).length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Clientes</h1>
        <p className="text-sm text-zinc-500">Crea gastrobares, contrata o quita agentes y suspende o reactiva cuentas. Sólo tú ves esta consola.</p>
      </div>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: 'Clientes activos', value: String(active.length), hint: `${tenants.length - active.length} suspendido(s)` },
          { label: 'Agentes contratados', value: String(totalAgents), hint: 'en clientes activos' },
          { label: 'Clientes en prueba', value: String(trials), hint: 'con algún agente en prueba' },
          { label: 'Costo de IA este mes', value: usd(aiCost), hint: 'todos los clientes · sólo lo ves tú' },
        ].map((k) => (
          <Card key={k.label} className="space-y-1">
            <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">{k.label}</p>
            <p className="text-2xl font-bold tabular-nums">{k.value}</p>
            <p className="text-xs text-zinc-500">{k.hint}</p>
          </Card>
        ))}
      </section>

      <div className="grid gap-5 lg:grid-cols-5">
        <div className="space-y-2 lg:col-span-3">
          {tenants.length === 0 ? (
            <Card>
              <p className="py-8 text-center text-sm text-zinc-500">Aún no hay clientes. Crea el primero con el formulario.</p>
            </Card>
          ) : (
            tenants.map((t) => (
              <Link
                key={t.id}
                href={`/platform/tenants/${t.id}`}
                className={cn(
                  'flex items-center gap-3 rounded-2xl border border-zinc-200 bg-white p-4 hover:border-brand-400 dark:border-zinc-800 dark:bg-zinc-900',
                  t.status === 'suspended' && 'opacity-60',
                )}
              >
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold">{t.name}</p>
                    <span className="text-xs text-zinc-500">/{t.slug}</span>
                    {t.status === 'suspended' ? (
                      <Badge className="bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-200">Suspendido</Badge>
                    ) : (
                      <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200">Activo</Badge>
                    )}
                    <Badge className="bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">IA {t.plan.label}</Badge>
                  </div>
                  <div className="flex flex-wrap items-center gap-1">
                    {t.activeAgents.map((a) => (
                      <span key={a} title={t.trialAgents.includes(a) ? 'En prueba' : 'Contratado'} className={cn(t.trialAgents.includes(a) && 'opacity-60')}>
                        <AgentAvatar agent={a} size="sm" />
                      </span>
                    ))}
                    {t.activeAgents.length === 0 && <span className="text-xs text-zinc-500">Sin agentes</span>}
                  </div>
                  <p className="text-xs text-zinc-500">
                    {t.users} usuario(s) · {t.paidOrders30d} cuentas en 30 días · IA {usd(t.aiCostMonth)} este mes
                  </p>
                </div>
                <ChevronRight className="size-5 shrink-0 text-zinc-400" aria-hidden />
              </Link>
            ))
          )}
        </div>
        <div className="lg:col-span-2">
          <CreateTenantForm plans={PLAN_OPTIONS.map((p) => ({ id: p.id, label: `${p.label} · ${p.reportsPerMonth} informes/mes` }))} />
        </div>
      </div>
    </div>
  );
}
