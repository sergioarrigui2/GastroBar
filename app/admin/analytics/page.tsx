import { AnalystPanel } from '@/components/admin/analytics/AnalystPanel';
import { AnalyticsDashboard } from '@/components/admin/analytics/AnalyticsDashboard';
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

  const [analysis, report] = await Promise.all([
    getBusinessAnalysis(ctx, rangeFromDays(ANALYSIS_RANGES[range].days)),
    getLatestReport(ctx, range),
  ]);

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
