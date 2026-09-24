import 'server-only';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import type { TenantContext } from '@/lib/tenant-context';
import { type AiPlan, monthStart, resolvePlan } from './plans';

export type AiQuota = {
  plan: AiPlan;
  periodStart: string;
  reportsUsed: number;
  reportsLeft: number;
  spentUsd: number;
  budgetLeftUsd: number;
  canGenerateReport: boolean;
  /** Motivo en lenguaje del dueño cuando no se puede generar. */
  blockedReason: string | null;
};

/** Plan, cupo y gasto de IA del mes calendario en curso (zona horaria del negocio). */
export async function getAiQuota(ctx: TenantContext): Promise<AiQuota> {
  const since = monthStart(ctx.tenant.timezone).toISOString();
  const [planRes, reportsRes, usageRes] = await Promise.all([
    ctx.supabase
      .from('tenant_ai_plans')
      .select('plan, reports_per_month, monthly_budget_usd, model_tier')
      .eq('tenant_id', ctx.tenant.id)
      .maybeSingle(),
    ctx.supabase
      .from('ai_reports')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', ctx.tenant.id)
      .eq('status', 'completed')
      .gte('created_at', since),
    // Los costos no son visibles para el gastrobar (RLS, 011): el servidor los lee con el rol de servicio.
    createSupabaseAdminClient().from('ai_usage').select('cost_usd').eq('tenant_id', ctx.tenant.id).gte('created_at', since),
  ]);
  if (planRes.error) throw planRes.error;
  if (reportsRes.error) throw reportsRes.error;
  if (usageRes.error) throw usageRes.error;

  const plan = resolvePlan(planRes.data);
  const reportsUsed = reportsRes.count ?? 0;
  const spentUsd = Math.round(usageRes.data.reduce((s, r) => s + Number(r.cost_usd ?? 0), 0) * 10_000) / 10_000;
  const reportsLeft = Math.max(0, plan.reportsPerMonth - reportsUsed);
  const budgetLeftUsd = Math.max(0, Math.round((plan.monthlyBudgetUsd - spentUsd) * 10_000) / 10_000);

  let blockedReason: string | null = null;
  if (plan.reportsPerMonth === 0) blockedReason = 'Tu plan no incluye informes del Analista.';
  else if (reportsLeft === 0) blockedReason = `Ya usaste los ${plan.reportsPerMonth} informes incluidos este mes.`;
  // Tope de uso justo: el cliente nunca ve montos, sólo que el cupo del mes se agotó.
  else if (budgetLeftUsd <= 0) blockedReason = 'Ya usaste el análisis con IA incluido este mes.';

  return {
    plan,
    periodStart: since,
    reportsUsed,
    reportsLeft,
    spentUsd,
    budgetLeftUsd,
    canGenerateReport: blockedReason === null,
    blockedReason,
  };
}
