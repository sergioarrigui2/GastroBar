import { AgentLocked } from '@/components/admin/ai/AgentLocked';
import { AnalystPanel } from '@/components/admin/analytics/AnalystPanel';
import { getAgentAccess } from '@/lib/ai/entitlements';
import { AnalyticsDashboard } from '@/components/admin/analytics/AnalyticsDashboard';
import { getAiQuota } from '@/lib/ai/quota';
import { isAnalystConfigured } from '@/lib/analyst/generate';
import { ANALYSIS_RANGES, type AnalysisRangeKey, getBusinessAnalysis, rangeFromDays } from '@/lib/services/analytics';
import { getLatestReport } from '@/lib/services/analyst-reports';
import { requirePageRole } from '@/lib/tenant-context';

export const metadata = { title: 'Análisis' };
/** El informe del analista hace una llamada al modelo dentro de la Server Action de esta página. */
export const maxDuration = 60;

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const ctx = await requirePageRole(['admin']);
  const { range: rawRange } = await searchParams;
  const range: AnalysisRangeKey = rawRange && rawRange in ANALYSIS_RANGES ? (rawRange as AnalysisRangeKey) : '30d';

  const [analysis, report, quota, access] = await Promise.all([
    getBusinessAnalysis(ctx, rangeFromDays(ANALYSIS_RANGES[range].days)),
    getLatestReport(ctx, range),
    getAiQuota(ctx),
    getAgentAccess(ctx),
  ]);

  return (
    <AnalyticsDashboard
      analysis={analysis}
      locale={ctx.tenant.locale}
      range={range}
      ranges={Object.entries(ANALYSIS_RANGES).map(([key, v]) => ({ key, label: v.label }))}
      locked={{
        alerts: access.vigia.active ? undefined : <AgentLocked agent="vigia" hint="El Vigía te mostraría aquí faltantes de caja e inventario, descuentos fuera de lo normal y demoras." />,
        menu: access.ingeniero.active ? undefined : <AgentLocked agent="ingeniero" hint="El Ingeniero de menú clasificaría aquí cada producto según lo que vende y lo que deja." />,
      }}
      analyst={
        access.analista.active ? (
        <AnalystPanel
          range={range}
          rangeLabel={ANALYSIS_RANGES[range].label}
          configured={isAnalystConfigured()}
          report={report}
          quota={{
            plan: quota.plan.label,
            left: quota.reportsLeft,
            total: quota.plan.reportsPerMonth,
            blockedReason: quota.blockedReason,
          }}
        />
        ) : (
          <AgentLocked agent="analista" hint="El Analista leería estas cifras por ti y te diría qué hacer esta semana, en orden de importancia." />
        )
      }
    />
  );
}
