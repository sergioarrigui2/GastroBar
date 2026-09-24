import 'server-only';
import { monthStart } from '@/lib/ai/plans';
import { type AiQuota, getAiQuota } from '@/lib/ai/quota';
import { isAnalystConfigured } from '@/lib/analyst/generate';
import { buildBriefing, type BriefingItem, greeting } from '@/lib/analytics/briefing';
import { detectedValue, type DetectedItem } from '@/lib/analytics/value';
import type { TenantContext } from '@/lib/tenant-context';
import { formatCurrency } from '@/lib/utils';
import { getBusinessAnalysis, rangeFromDays } from './analytics';
import { listReports, type ReportWithPeriod } from './analyst-reports';

export type AiTeamOverview = {
  configured: boolean;
  quota: AiQuota;
  detected: { total: number; items: DetectedItem[]; since: string };
  latestReport: ReportWithPeriod | null;
  reportsThisMonth: number;
  purchase: PurchaseStatus;
};

export type PurchaseStatus = {
  active: boolean;
  nextRunAt: string | null;
  frequency: string | null;
  latest: { id: string; created_at: string; status: string; lines: number; urgent: number; total: number } | null;
};

const NO_PURCHASE: PurchaseStatus = { active: false, nextRunAt: null, frequency: null, latest: null };

async function getPurchaseStatus(ctx: TenantContext): Promise<PurchaseStatus> {
  const [schedule, latest] = await Promise.all([
    ctx.supabase
      .from('agent_schedules')
      .select('is_active, next_run_at, frequency')
      .eq('tenant_id', ctx.tenant.id)
      .eq('agent', 'purchase')
      .maybeSingle(),
    ctx.supabase
      .from('purchase_suggestions')
      .select('id, created_at, status, lines, total_estimated')
      .eq('tenant_id', ctx.tenant.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (schedule.error) throw schedule.error;
  if (latest.error) throw latest.error;
  const lines = (latest.data?.lines as Array<{ urgent?: boolean }> | undefined) ?? [];
  return {
    active: Boolean(schedule.data?.is_active),
    nextRunAt: schedule.data?.is_active ? (schedule.data.next_run_at ?? null) : null,
    frequency: schedule.data?.frequency ?? null,
    latest: latest.data
      ? {
          id: latest.data.id,
          created_at: latest.data.created_at,
          status: latest.data.status,
          lines: lines.length,
          urgent: lines.filter((l) => l.urgent).length,
          total: Number(latest.data.total_estimated),
        }
      : null,
  };
}

/** Todo lo que muestra la sección Equipo IA. No llama al modelo. */
export async function getAiTeamOverview(ctx: TenantContext): Promise<AiTeamOverview> {
  const since = monthStart(ctx.tenant.timezone);
  const now = new Date();
  // Los primeros minutos del mes no hay rango válido: se usa al menos una hora.
  const from = now.getTime() - since.getTime() < 3_600_000 ? new Date(now.getTime() - 3_600_000) : since;

  const [quota, monthAnalysis, reports, purchase] = await Promise.all([
    getAiQuota(ctx),
    getBusinessAnalysis(ctx, { from: from.toISOString(), to: now.toISOString() }),
    listReports(ctx, 1),
    getPurchaseStatus(ctx).catch(() => NO_PURCHASE),
  ]);

  return {
    configured: isAnalystConfigured(),
    quota,
    detected: { ...detectedValue(monthAnalysis), since: since.toISOString() },
    latestReport: reports[0] ?? null,
    reportsThisMonth: quota.reportsUsed,
    purchase,
  };
}

export type DailyBriefing = { greeting: string; items: BriefingItem[]; reportId: string | null };

/** Resumen del día para la portada del admin: último informe reciente + alertas de 7 días. Sin LLM. */
export async function getDailyBriefing(ctx: TenantContext): Promise<DailyBriefing> {
  const [analysis, reports, purchase] = await Promise.all([
    getBusinessAnalysis(ctx, rangeFromDays(7)),
    listReports(ctx, 1),
    getPurchaseStatus(ctx).catch(() => NO_PURCHASE),
  ]);
  const latest = reports[0] ?? null;
  const pending = purchase.latest?.status === 'draft' ? purchase.latest : null;
  return {
    greeting: greeting(ctx.tenant.timezone),
    items: buildBriefing({
      report: latest,
      anomalies: analysis.anomalies,
      purchase: pending
        ? {
            created_at: pending.created_at,
            lines: pending.lines,
            urgent: pending.urgent,
            total_label: formatCurrency(pending.total, ctx.tenant.currency, ctx.tenant.locale),
          }
        : null,
    }),
    reportId: latest?.id ?? null,
  };
}
