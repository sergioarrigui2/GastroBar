import 'server-only';
import type { StoredReport } from '@/components/admin/analytics/ReportView';
import type { AnalystReport, ReportVerification } from '@/lib/analyst/report';
import type { TenantContext } from '@/lib/tenant-context';
import { formatDateTime } from '@/lib/utils';

const COLUMNS = 'id, range_key, created_at, period_from, period_to, model, content, verification, input_tokens, output_tokens, duration_ms, cost_usd';

type Row = {
  id: string;
  range_key: string | null;
  created_at: string;
  period_from: string;
  period_to: string;
  model: string;
  content: unknown;
  verification: unknown;
  input_tokens: number | null;
  output_tokens: number | null;
  duration_ms: number | null;
  cost_usd: number | null;
};

export type ReportWithPeriod = StoredReport & { period_label: string };

function toStored(ctx: TenantContext, row: Row): ReportWithPeriod {
  const { locale, timezone } = ctx.tenant;
  const day = (iso: string) => new Intl.DateTimeFormat(locale, { timeZone: timezone, day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso));
  return {
    id: row.id,
    range_key: row.range_key,
    created_at: row.created_at,
    model: row.model,
    content: row.content as AnalystReport,
    verification: row.verification as ReportVerification | null,
    input_tokens: row.input_tokens,
    output_tokens: row.output_tokens,
    duration_ms: row.duration_ms,
    cost_usd: row.cost_usd,
    created_label: `Generado el ${formatDateTime(row.created_at, locale, timezone)}`,
    period_label: `${day(row.period_from)} – ${day(row.period_to)}`,
  };
}

/** Último informe completado de un rango (7d/30d/90d). */
export async function getLatestReport(ctx: TenantContext, rangeKey: string): Promise<ReportWithPeriod | null> {
  const { data, error } = await ctx.supabase
    .from('ai_reports')
    .select(COLUMNS)
    .eq('tenant_id', ctx.tenant.id)
    .eq('status', 'completed')
    .eq('range_key', rangeKey)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ? toStored(ctx, data) : null;
}

export async function listReports(ctx: TenantContext, limit = 50): Promise<ReportWithPeriod[]> {
  const { data, error } = await ctx.supabase
    .from('ai_reports')
    .select(COLUMNS)
    .eq('tenant_id', ctx.tenant.id)
    .eq('status', 'completed')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data.map((row) => toStored(ctx, row));
}

export async function getReport(ctx: TenantContext, id: string): Promise<ReportWithPeriod | null> {
  const { data, error } = await ctx.supabase
    .from('ai_reports')
    .select(COLUMNS)
    .eq('tenant_id', ctx.tenant.id)
    .eq('id', id)
    .eq('status', 'completed')
    .maybeSingle();
  if (error) throw error;
  return data ? toStored(ctx, data) : null;
}
