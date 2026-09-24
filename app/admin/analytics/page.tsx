import { AnalystPanel, type StoredReport } from '@/components/admin/analytics/AnalystPanel';
import { AnalyticsDashboard } from '@/components/admin/analytics/AnalyticsDashboard';
import { isAnalystConfigured } from '@/lib/analyst/generate';
import type { AnalystReport, ReportVerification } from '@/lib/analyst/report';
import { ANALYSIS_RANGES, type AnalysisRangeKey, getBusinessAnalysis, rangeFromDays } from '@/lib/services/analytics';
import { requirePageRole } from '@/lib/tenant-context';
import { formatDateTime } from '@/lib/utils';

export const metadata = { title: 'Análisis' };
/** El informe del analista hace una llamada al modelo dentro de la Server Action de esta página. */
export const maxDuration = 60;

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const ctx = await requirePageRole(['admin']);
  const { range: rawRange } = await searchParams;
  const range: AnalysisRangeKey = rawRange && rawRange in ANALYSIS_RANGES ? (rawRange as AnalysisRangeKey) : '30d';

  const [analysis, { data: latest, error }] = await Promise.all([
    getBusinessAnalysis(ctx, rangeFromDays(ANALYSIS_RANGES[range].days)),
    ctx.supabase
      .from('ai_reports')
      .select('id, range_key, created_at, model, content, verification, input_tokens, output_tokens, duration_ms, cost_usd')
      .eq('tenant_id', ctx.tenant.id)
      .eq('status', 'completed')
      .eq('range_key', range)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (error) throw error;

  const report: StoredReport | null = latest
    ? {
        ...latest,
        content: latest.content as unknown as AnalystReport,
        verification: latest.verification as unknown as ReportVerification | null,
        created_label: `Generado el ${formatDateTime(latest.created_at, ctx.tenant.locale, ctx.tenant.timezone)}`,
      }
    : null;

  return (
    <AnalyticsDashboard
      analysis={analysis}
      locale={ctx.tenant.locale}
      range={range}
      ranges={Object.entries(ANALYSIS_RANGES).map(([key, v]) => ({ key, label: v.label }))}
      analyst={
        <AnalystPanel
          range={range}
          rangeLabel={ANALYSIS_RANGES[range].label}
          configured={isAnalystConfigured()}
          report={report}
        />
      }
    />
  );
}
