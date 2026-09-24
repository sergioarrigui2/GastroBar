import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { TenantControls } from '@/components/platform/TenantControls';
import { Card } from '@/components/ui/primitives';
import { getTenantDetail, PLAN_OPTIONS } from '@/lib/platform/service';
import { formatDateTime } from '@/lib/utils';

export const metadata = { title: 'Cliente' };

const FEATURE: Record<string, string> = { analyst_report: 'Informe del Analista', purchase_agent: 'Revisión del Comprador', analyst_chat: 'Chat' };
const usd = (n: number, d = 4) => `USD ${n.toFixed(d)}`;

export default async function TenantPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = await getTenantDetail(id).catch(() => null);
  if (!detail) notFound();
  const { tenant } = detail;
  const when = (iso: string) => formatDateTime(iso, tenant.locale, tenant.timezone);

  return (
    <div className="space-y-6">
      <Link href="/platform" className="inline-flex items-center gap-1 text-sm font-medium text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
        <ArrowLeft className="size-4" /> Clientes
      </Link>
      <div>
        <h1 className="text-2xl font-bold">{tenant.name}</h1>
        <p className="text-sm text-zinc-500">
          /{tenant.slug} · creado {when(tenant.created_at)} · {detail.profiles.filter((p) => p.is_active).length} usuario(s)
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <TenantControls
            tenantId={tenant.id}
            status={tenant.status}
            statusReason={tenant.status_reason}
            notes={tenant.platform_notes}
            access={detail.access}
            plan={detail.planRow ?? { plan: detail.plan.id, reports_per_month: null, monthly_budget_usd: null, model_tier: null }}
            plans={PLAN_OPTIONS}
          />
        </div>
        <div className="space-y-4 lg:col-span-2">
          <Card className="space-y-2">
            <h2 className="font-semibold">Administradores</h2>
            <ul className="space-y-1 text-sm">
              {detail.owners.map((o) => (
                <li key={o.id}>
                  <b>{o.full_name}</b> <span className="text-zinc-500">{o.email ?? '—'}</span>
                  {!o.is_active && <span className="ml-1 text-xs text-red-600">(inactivo)</span>}
                </li>
              ))}
            </ul>
          </Card>
          <Card className="space-y-1">
            <h2 className="font-semibold">IA este mes</h2>
            <p className="text-2xl font-bold tabular-nums">{usd(detail.aiCostMonth, 3)}</p>
            <p className="text-sm text-zinc-500">
              {detail.reportsMonth} informe(s) de {detail.plan.reportsPerMonth} · tope {usd(detail.plan.monthlyBudgetUsd, 2)}
            </p>
          </Card>
          <Card>
            <h2 className="mb-2 font-semibold">Últimas llamadas a la IA</h2>
            {detail.usage.length === 0 ? (
              <p className="text-sm text-zinc-500">Sin consumo.</p>
            ) : (
              <ul className="divide-y divide-zinc-100 text-xs dark:divide-zinc-800">
                {detail.usage.map((u) => (
                  <li key={u.id} className="flex flex-wrap justify-between gap-2 py-1.5 tabular-nums">
                    <span>
                      {when(u.created_at)} · {FEATURE[u.feature] ?? u.feature}
                      {u.status === 'error' && <b className="ml-1 text-amber-600">error</b>}
                    </span>
                    <span className="text-zinc-500">
                      {u.model} · {u.input_tokens}+{u.output_tokens} · <b className="text-zinc-900 dark:text-zinc-100">{usd(Number(u.cost_usd ?? 0))}</b>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
