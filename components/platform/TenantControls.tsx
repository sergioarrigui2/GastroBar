'use client';

import { useState } from 'react';
import { setTenantAgentsAction, setTenantNotesAction, setTenantPlanAction, setTenantStatusAction } from '@/app/actions/platform';
import { AgentAvatar } from '@/components/admin/ai/AgentAvatar';
import { FlashMessage, useAdminMutation } from '@/components/admin/useAdminMutation';
import { Badge, Button, Card, Input, Label, Select } from '@/components/ui/primitives';
import { AGENT_STATUS_LABEL, type AgentAccess } from '@/lib/ai/access';
import { AGENT_ORDER, AGENTS, type AgentId } from '@/lib/ai/agents';
import { cn } from '@/lib/utils';

type Mode = 'contracted' | 'trial' | 'off';

export function TenantControls({
  tenantId,
  status,
  statusReason,
  notes,
  access,
  plan,
  plans,
}: {
  tenantId: string;
  status: 'active' | 'suspended';
  statusReason: string | null;
  notes: string | null;
  access: AgentAccess;
  plan: { plan: string; reports_per_month: number | null; monthly_budget_usd: number | null; model_tier: string | null };
  plans: Array<{ id: string; label: string; reportsPerMonth: number; monthlyBudgetUsd: number }>;
}) {
  const { pending, flash, run } = useAdminMutation();
  const today = new Date();
  const toDate = (iso: string | null) => (iso ? iso.slice(0, 10) : new Date(today.getTime() + 14 * 86_400_000).toISOString().slice(0, 10));

  const [agents, setAgents] = useState<Record<AgentId, { mode: Mode; until: string }>>(
    () =>
      Object.fromEntries(
        AGENT_ORDER.map((a) => [a, { mode: access[a].status as Mode, until: toDate(access[a].trialUntil) }]),
      ) as Record<AgentId, { mode: Mode; until: string }>,
  );
  const [reason, setReason] = useState(statusReason ?? '');
  const [planForm, setPlanForm] = useState({
    plan: plan.plan,
    reports_per_month: plan.reports_per_month === null ? '' : String(plan.reports_per_month),
    monthly_budget_usd: plan.monthly_budget_usd === null ? '' : String(plan.monthly_budget_usd),
    model_tier: plan.model_tier ?? '',
  });
  const [notesText, setNotesText] = useState(notes ?? '');
  const base = plans.find((p) => p.id === planForm.plan);

  return (
    <div className="space-y-4">
      <Card className="space-y-4">
        <h2 className="font-semibold">Agentes contratados</h2>
        <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {AGENT_ORDER.map((a) => (
            <li key={a} className="flex flex-wrap items-center gap-3 py-3">
              <AgentAvatar agent={a} size="sm" />
              <span className="w-36 font-medium">{AGENTS[a].name}</span>
              <Badge
                className={cn(
                  access[a].status === 'contracted' && 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200',
                  access[a].status === 'trial' && 'bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-200',
                  access[a].status === 'off' && 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300',
                )}
              >
                Hoy: {AGENT_STATUS_LABEL[access[a].status]}
              </Badge>
              <Select
                aria-label={`Estado de ${AGENTS[a].name}`}
                value={agents[a].mode}
                onChange={(e) => setAgents((s) => ({ ...s, [a]: { ...s[a], mode: e.target.value as Mode } }))}
                className="ml-auto h-9 w-40"
              >
                <option value="contracted">Contratado</option>
                <option value="trial">En prueba hasta…</option>
                <option value="off">No contratado</option>
              </Select>
              {agents[a].mode === 'trial' && (
                <Input
                  type="date"
                  aria-label={`Prueba de ${AGENTS[a].name} hasta`}
                  value={agents[a].until}
                  onChange={(e) => setAgents((s) => ({ ...s, [a]: { ...s[a], until: e.target.value } }))}
                  className="h-9 w-40"
                />
              )}
            </li>
          ))}
        </ul>
        <Button
          disabled={pending}
          onClick={() =>
            run(
              () =>
                setTenantAgentsAction(
                  tenantId,
                  AGENT_ORDER.map((a) => ({
                    agent: a,
                    enabled: agents[a].mode !== 'off',
                    trial_until: agents[a].mode === 'trial' ? new Date(`${agents[a].until}T23:59:59-05:00`).toISOString() : null,
                  })),
                ),
              'Agentes actualizados',
            )
          }
        >
          Guardar agentes
        </Button>
      </Card>

      <Card className="space-y-4">
        <h2 className="font-semibold">Plan del Analista (uso justo, invisible para el cliente)</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="p-plan">Plan</Label>
            <Select id="p-plan" value={planForm.plan} onChange={(e) => setPlanForm((f) => ({ ...f, plan: e.target.value }))}>
              {plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="p-tier">Modelos</Label>
            <Select id="p-tier" value={planForm.model_tier} onChange={(e) => setPlanForm((f) => ({ ...f, model_tier: e.target.value }))}>
              <option value="">Los del plan</option>
              <option value="economy">Económico (Haiku)</option>
              <option value="balanced">Según complejidad</option>
              <option value="premium">Premium (Sonnet)</option>
            </Select>
          </div>
          <div>
            <Label htmlFor="p-reports">Informes al mes</Label>
            <Input
              id="p-reports"
              type="number"
              min={0}
              placeholder={base ? `${base.reportsPerMonth} (del plan)` : ''}
              value={planForm.reports_per_month}
              onChange={(e) => setPlanForm((f) => ({ ...f, reports_per_month: e.target.value }))}
            />
          </div>
          <div>
            <Label htmlFor="p-budget">Tope de gasto USD/mes</Label>
            <Input
              id="p-budget"
              type="number"
              min={0}
              step="0.5"
              placeholder={base ? `${base.monthlyBudgetUsd} (del plan)` : ''}
              value={planForm.monthly_budget_usd}
              onChange={(e) => setPlanForm((f) => ({ ...f, monthly_budget_usd: e.target.value }))}
            />
          </div>
        </div>
        <Button
          disabled={pending}
          onClick={() =>
            run(
              () =>
                setTenantPlanAction(tenantId, {
                  plan: planForm.plan as 'pro',
                  reports_per_month: planForm.reports_per_month === '' ? null : Number(planForm.reports_per_month),
                  monthly_budget_usd: planForm.monthly_budget_usd === '' ? null : Number(planForm.monthly_budget_usd),
                  model_tier: (planForm.model_tier || null) as 'economy' | null,
                }),
              'Plan actualizado',
            )
          }
        >
          Guardar plan
        </Button>
      </Card>

      <Card className="space-y-3">
        <h2 className="font-semibold">Estado de la cuenta</h2>
        {status === 'active' ? (
          <>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Suspender bloquea el acceso de todo el equipo del gastrobar sin borrar sus datos. Puedes reactivarlo cuando quieras.
            </p>
            <div>
              <Label htmlFor="s-reason">Motivo (sólo lo ves tú)</Label>
              <Input id="s-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ej. pago pendiente de septiembre" />
            </div>
            <Button variant="danger" disabled={pending} onClick={() => run(() => setTenantStatusAction(tenantId, 'suspended', reason), 'Cliente suspendido')}>
              Suspender cliente
            </Button>
          </>
        ) : (
          <>
            <p className="text-sm text-red-600">Suspendido: {statusReason ?? 'sin motivo'}</p>
            <Button variant="success" disabled={pending} onClick={() => run(() => setTenantStatusAction(tenantId, 'active', null), 'Cliente reactivado')}>
              Reactivar cliente
            </Button>
          </>
        )}
      </Card>

      <Card className="space-y-3">
        <h2 className="font-semibold">Notas internas</h2>
        <textarea
          value={notesText}
          onChange={(e) => setNotesText(e.target.value)}
          rows={4}
          className="w-full rounded-xl border border-zinc-300 bg-white p-3 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          placeholder="Precio acordado, contacto, fecha de cobro…"
        />
        <Button variant="secondary" disabled={pending} onClick={() => run(() => setTenantNotesAction(tenantId, notesText), 'Notas guardadas')}>
          Guardar notas
        </Button>
      </Card>

      <FlashMessage flash={flash} />
    </div>
  );
}
