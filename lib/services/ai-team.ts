import 'server-only';
import { monthStart } from '@/lib/ai/plans';
import { type AiQuota, getAiQuota } from '@/lib/ai/quota';
import { isAnalystConfigured } from '@/lib/analyst/generate';
import { buildBriefing, type BriefingItem, greeting } from '@/lib/analytics/briefing';
import { detectedValue, type DetectedItem } from '@/lib/analytics/value';
import type { TenantContext } from '@/lib/tenant-context';
import { getBusinessAnalysis, rangeFromDays } from './analytics';
import { listReports, type ReportWithPeriod } from './analyst-reports';

export type AiTeamOverview = {
  configured: boolean;
  quota: AiQuota;
  detected: { total: number; items: DetectedItem[]; since: string };
  latestReport: ReportWithPeriod | null;
  reportsThisMonth: number;
};

/** Todo lo que muestra la sección Equipo IA. No llama al modelo. */
export async function getAiTeamOverview(ctx: TenantContext): Promise<AiTeamOverview> {
  const since = monthStart(ctx.tenant.timezone);
  const now = new Date();
  // Los primeros minutos del mes no hay rango válido: se usa al menos una hora.
  const from = now.getTime() - since.getTime() < 3_600_000 ? new Date(now.getTime() - 3_600_000) : since;

  const [quota, monthAnalysis, reports] = await Promise.all([
    getAiQuota(ctx),
    getBusinessAnalysis(ctx, { from: from.toISOString(), to: now.toISOString() }),
    listReports(ctx, 1),
  ]);

  return {
    configured: isAnalystConfigured(),
    quota,
    detected: { ...detectedValue(monthAnalysis), since: since.toISOString() },
    latestReport: reports[0] ?? null,
    reportsThisMonth: quota.reportsUsed,
  };
}

export type DailyBriefing = { greeting: string; items: BriefingItem[]; reportId: string | null };

/** Resumen del día para la portada del admin: último informe reciente + alertas de 7 días. Sin LLM. */
export async function getDailyBriefing(ctx: TenantContext): Promise<DailyBriefing> {
  const [analysis, reports] = await Promise.all([getBusinessAnalysis(ctx, rangeFromDays(7)), listReports(ctx, 1)]);
  const latest = reports[0] ?? null;
  return {
    greeting: greeting(ctx.tenant.timezone),
    items: buildBriefing({ report: latest, anomalies: analysis.anomalies }),
    reportId: latest?.id ?? null,
  };
}
