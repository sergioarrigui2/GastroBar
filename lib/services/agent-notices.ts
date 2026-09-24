import 'server-only';
import type { NoticeItem } from '@/components/admin/ai/AgentAvatar';
import type { MenuClass } from '@/lib/analytics/types';
import { getAgentAccess } from '@/lib/ai/entitlements';
import type { TenantContext } from '@/lib/tenant-context';
import { getBusinessAnalysis, rangeFromDays } from './analytics';

/**
 * Lo que cada agente tiene que decir dentro de un módulo, con los últimos 30 días.
 * Sin IA. Si algo falla (p. ej. faltan migraciones), no hay avisos: el módulo
 * nunca se rompe por culpa de un agente.
 */
export type MenuInsight = { class: MenuClass; food_cost_pct: number | null; mix_pct: number; unit_margin: number; quantity: number };

async function analysis30(ctx: TenantContext) {
  return getBusinessAnalysis(ctx, rangeFromDays(30));
}

const safe = async <T>(fn: () => Promise<T>, fallback: T): Promise<T> => {
  try {
    return await fn();
  } catch (error) {
    console.error('[agent-notices]', error);
    return fallback;
  }
};

export function getMenuInsights(ctx: TenantContext) {
  return safe(async () => {
    if (!(await getAgentAccess(ctx)).ingeniero.active) return { insights: {} as Record<string, MenuInsight>, notice: [] as NoticeItem[] };
    const a = await analysis30(ctx);
    const insights: Record<string, MenuInsight> = {};
    for (const p of a.menu.products) {
      insights[p.product_id] = { class: p.class, food_cost_pct: p.food_cost_pct, mix_pct: p.mix_pct, unit_margin: p.unit_margin, quantity: p.quantity };
    }
    const byClass = (c: MenuClass) => a.menu.products.filter((p) => p.class === c).map((p) => p.name);
    const notice: NoticeItem[] = [];
    const dogs = byClass('dog');
    const horses = a.menu.products.filter((p) => p.class === 'plowhorse' && (p.food_cost_pct ?? 0) > 35).map((p) => p.name);
    const puzzles = byClass('puzzle');
    if (dogs.length) notice.push({ severity: 'warning', title: `${dogs.length} perro(s): se venden poco y dejan poco`, detail: dogs.slice(0, 4).join(', ') });
    if (horses.length) notice.push({ severity: 'warning', title: 'Caballos de batalla con costo alto: revisa porción o precio', detail: horses.slice(0, 4).join(', ') });
    if (puzzles.length) notice.push({ severity: 'info', title: `${puzzles.length} enigma(s): buen margen, pocas ventas; promociónalos`, detail: puzzles.slice(0, 4).join(', ') });
    if (a.snapshot.unsold_products.length)
      notice.push({ severity: 'info', title: `${a.snapshot.unsold_products.length} producto(s) sin ventas en 30 días`, detail: a.snapshot.unsold_products.slice(0, 4).map((p) => p.name).join(', ') });
    return { insights, notice };
  }, { insights: {} as Record<string, MenuInsight>, notice: [] as NoticeItem[] });
}

export function getInventoryNotices(ctx: TenantContext) {
  return safe(async () => {
    const access = await getAgentAccess(ctx);
    const a = await analysis30(ctx);
    const vigia: NoticeItem[] = (access.vigia.active ? a.anomalies : [])
      .filter((x) => x.kind === 'shrinkage' || x.kind === 'waste' || x.kind === 'low_stock')
      .map((x) => ({ severity: x.severity, title: x.title, detail: x.detail }));
    const { data } = await ctx.supabase
      .from('purchase_suggestions')
      .select('id, status, lines, created_at')
      .eq('tenant_id', ctx.tenant.id)
      .eq('status', 'draft')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const lines = (data?.lines as Array<{ name: string; urgent?: boolean; days_left?: number | null }> | undefined) ?? [];
    const urgent = lines.filter((l) => l.urgent);
    const comprador: NoticeItem[] = data && access.comprador.active
      ? [
          {
            severity: urgent.length ? 'critical' : 'info',
            title: urgent.length ? `${urgent.length} insumo(s) se agotan antes de la próxima entrega` : `Pedido listo con ${lines.length} insumo(s)`,
            detail: (urgent.length ? urgent : lines)
              .slice(0, 4)
              .map((l) => (l.days_left !== null && l.days_left !== undefined ? `${l.name} (≈ ${l.days_left} días)` : l.name))
              .join(', '),
          },
        ]
      : [];
    return { vigia, comprador };
  }, { vigia: [] as NoticeItem[], comprador: [] as NoticeItem[] });
}

export function getCashNotices(ctx: TenantContext) {
  if (ctx.role !== 'admin') return Promise.resolve([] as NoticeItem[]);
  return safe(async () => {
    if (!(await getAgentAccess(ctx)).vigia.active) return [] as NoticeItem[];
    const a = await analysis30(ctx);
    const diffs = a.snapshot.cash.differences.map((d) => Number(d.difference));
    const short = diffs.filter((d) => d < 0);
    if (!diffs.length) return [] as NoticeItem[];
    const byPerson = new Map<string, number>();
    a.snapshot.cash.differences.filter((d) => Number(d.difference) < 0).forEach((d) => byPerson.set(d.closed_by ?? 'Sin nombre', (byPerson.get(d.closed_by ?? 'Sin nombre') ?? 0) + 1));
    const items: NoticeItem[] = [
      {
        severity: short.length >= 2 ? 'critical' : 'warning',
        title: `${diffs.length} cierre(s) con diferencia en 30 días`,
        detail: `${short.length} con faltante${[...byPerson.entries()].length ? ` · ${[...byPerson.entries()].map(([n, c]) => `${n}: ${c}`).join(', ')}` : ''}`,
      },
    ];
    return items;
  }, [] as NoticeItem[]);
}

export function getStaffNotices(ctx: TenantContext) {
  return safe(async () => {
    if (!(await getAgentAccess(ctx)).vigia.active) return [] as NoticeItem[];
    const a = await analysis30(ctx);
    return a.anomalies
      .filter((x) => x.kind === 'staff_discounts' || x.kind === 'staff_voids' || x.kind === 'cash_difference')
      .map((x) => ({ severity: x.severity, title: x.title, detail: x.detail }) satisfies NoticeItem);
  }, [] as NoticeItem[]);
}
