import 'server-only';
import { monthStart } from '@/lib/ai/plans';
import { getAiQuota } from '@/lib/ai/quota';
import type { AgentId } from '@/lib/ai/agents';
import { MENU_CLASS_LABEL } from '@/lib/analytics/analyze';
import { detectedValue } from '@/lib/analytics/value';
import type { TenantContext } from '@/lib/tenant-context';
import { formatCurrency } from '@/lib/utils';
import { getBusinessAnalysis } from './analytics';

export type AgentStat = { label: string; value: string; hint?: string };

/** "Mi trabajo este mes": cifras reales de lo que hizo cada agente. Sin IA. */
export async function getAgentStats(ctx: TenantContext, agent: AgentId): Promise<AgentStat[]> {
  const since = monthStart(ctx.tenant.timezone);
  const now = new Date();
  const sinceIso = since.toISOString();
  const money = (n: number) => formatCurrency(n, ctx.tenant.currency, ctx.tenant.locale);
  const t = ctx.tenant.id;

  const monthAnalysis = () =>
    getBusinessAnalysis(ctx, {
      from: (now.getTime() - since.getTime() < 3_600_000 ? new Date(now.getTime() - 3_600_000) : since).toISOString(),
      to: now.toISOString(),
    });

  if (agent === 'vigia') {
    const a = await monthAnalysis();
    const v = detectedValue(a);
    const critical = a.anomalies.filter((x) => x.severity === 'critical').length;
    return [
      { label: 'Alertas este mes', value: String(a.anomalies.length), hint: critical ? `${critical} crítica(s)` : 'ninguna crítica' },
      { label: 'Plata detectada', value: money(v.total), hint: 'fugas y sobrecostos puestos a la vista' },
      { label: 'Cierres de caja revisados', value: String(a.snapshot.cash.sessions), hint: `${a.snapshot.cash.differences.length} con diferencia` },
    ];
  }

  if (agent === 'ingeniero') {
    const a = await monthAnalysis();
    const counts = { star: 0, plowhorse: 0, puzzle: 0, dog: 0 };
    a.menu.products.forEach((p) => counts[p.class]++);
    const overrun = detectedValue(a).items.find((i) => i.key === 'food_cost');
    return [
      { label: 'Productos analizados', value: String(a.menu.products.length), hint: `${a.snapshot.unsold_products.length} sin ventas` },
      {
        label: 'Clasificación',
        value: `${counts.star} ⭐ · ${counts.plowhorse} 🐴 · ${counts.puzzle} ❓ · ${counts.dog} 🐕`,
        hint: `${MENU_CLASS_LABEL.star}, ${MENU_CLASS_LABEL.plowhorse.toLowerCase()}, ${MENU_CLASS_LABEL.puzzle.toLowerCase()}, ${MENU_CLASS_LABEL.dog.toLowerCase()}`,
      },
      { label: 'Sobrecosto detectado', value: money(overrun?.amount ?? 0), hint: 'productos con food cost > 40%' },
    ];
  }

  if (agent === 'analista') {
    const [{ data: reports }, quota] = await Promise.all([
      ctx.supabase.from('ai_reports').select('content').eq('tenant_id', t).eq('status', 'completed').gte('created_at', sinceIso),
      getAiQuota(ctx),
    ]);
    const findings = (reports ?? []).reduce((s, r) => s + ((r.content as { findings?: unknown[] } | null)?.findings?.length ?? 0), 0);
    return [
      { label: 'Informes este mes', value: String(reports?.length ?? 0) },
      { label: 'Hallazgos y acciones', value: String(findings) },
      { label: 'Informes disponibles', value: `${quota.reportsLeft} de ${quota.plan.reportsPerMonth}`, hint: 'incluidos en tu plan este mes' },
    ];
  }

  if (agent === 'comprador') {
    const { data: suggestions } = await ctx.supabase
      .from('purchase_suggestions')
      .select('status, lines, total_estimated, trigger')
      .eq('tenant_id', t)
      .gte('created_at', sinceIso);
    const list = suggestions ?? [];
    const urgent = list.reduce((s, r) => s + ((r.lines as Array<{ urgent?: boolean }>) ?? []).filter((l) => l.urgent).length, 0);
    const received = list.filter((r) => r.status === 'received');
    return [
      { label: 'Pedidos calculados', value: String(list.length), hint: `${list.filter((r) => r.trigger === 'schedule').length} automáticos` },
      { label: 'Pedidos recibidos', value: String(received.length), hint: money(received.reduce((s, r) => s + Number(r.total_estimated), 0)) },
      { label: 'Insumos urgentes avisados', value: String(urgent), hint: 'se habrían agotado antes de la entrega' },
    ];
  }

  const { data: deliveries } = await ctx.supabase
    .from('messenger_deliveries')
    .select('status, created_at')
    .eq('tenant_id', t)
    .gte('created_at', sinceIso)
    .order('created_at', { ascending: false });
  const sent = (deliveries ?? []).filter((d) => d.status === 'sent');
  return [
    { label: 'Resúmenes enviados', value: String(sent.length), hint: `${(deliveries ?? []).length - sent.length} con error` },
  ];
}
