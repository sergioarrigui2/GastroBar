import 'server-only';
import { analyzeSnapshot, withActiveStations } from '@/lib/analytics/analyze';
import type { BusinessAnalysis, RawBusinessSnapshot } from '@/lib/analytics/types';
import type { TenantContext } from '@/lib/tenant-context';
import { formatCurrency } from '@/lib/utils';

export const ANALYSIS_RANGES = {
  '7d': { label: 'Últimos 7 días', days: 7 },
  '30d': { label: 'Últimos 30 días', days: 30 },
  '90d': { label: 'Últimos 90 días', days: 90 },
} as const;
export type AnalysisRangeKey = keyof typeof ANALYSIS_RANGES;

/** Rango que termina ahora y cubre N días completos hacia atrás. */
export function rangeFromDays(days: number, now = new Date()): { from: string; to: string } {
  return { from: new Date(now.getTime() - days * 86_400_000).toISOString(), to: now.toISOString() };
}

/** Resumen exacto del negocio (SQL) + interpretación determinista (anomalías, menú). */
export async function getBusinessAnalysis(ctx: TenantContext, range: { from: string; to: string }): Promise<BusinessAnalysis> {
  const { data, error } = await ctx.supabase.rpc('get_business_snapshot', { p_from: range.from, p_to: range.to });
  if (error) throw error;
  const snapshot = withActiveStations(data as unknown as RawBusinessSnapshot, { kitchen: ctx.tenant.uses_kitchen_screen, bar: ctx.tenant.uses_bar_screen });
  return analyzeSnapshot(snapshot, (n) => formatCurrency(n, ctx.tenant.currency, ctx.tenant.locale));
}
