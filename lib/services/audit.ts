import 'server-only';
import { z } from 'zod';
import { type ActorTotals, summarizeByActor } from '@/lib/audit/describe';
import { addDays, localDay, localMidnight } from '@/lib/services/sales-history';
import type { TenantContext } from '@/lib/tenant-context';
import type { AuditCategory, AuditSeverity } from '@/types/database';

export const AUDIT_RANGES = {
  hoy: { label: 'Hoy', days: 1 },
  '7d': { label: 'Últimos 7 días', days: 7 },
  '30d': { label: 'Últimos 30 días', days: 30 },
  '90d': { label: 'Últimos 90 días', days: 90 },
} as const;
export type AuditRangeKey = keyof typeof AUDIT_RANGES;

/** relevant = importantes y críticos (lo que conviene revisar); all = también la operación normal. */
export const AUDIT_SEVERITY_FILTERS = { relevant: 'Importantes y críticos', critical: 'Sólo críticos', all: 'Todo, incluida la operación normal' } as const;
export type AuditSeverityFilter = keyof typeof AUDIT_SEVERITY_FILTERS;

export const PAGE_SIZE = 60;

const CATEGORIES = ['ventas', 'caja', 'inventario', 'menu', 'compras', 'personal', 'ajustes', 'seguridad'] as const satisfies readonly AuditCategory[];

const filtersSchema = z.object({
  rango: z.enum(['hoy', '7d', '30d', '90d']).catch('7d'),
  gravedad: z.enum(['relevant', 'critical', 'all']).catch('relevant'),
  categoria: z.enum(CATEGORIES).optional().catch(undefined),
  persona: z.union([z.uuid(), z.literal('sistema')]).optional().catch(undefined),
  pagina: z.coerce.number().int().min(1).max(500).catch(1),
});
export type AuditFilters = {
  range: AuditRangeKey;
  severity: AuditSeverityFilter;
  category?: AuditCategory;
  actor?: string;
  page: number;
};

/** Filtros desde la URL (valores no válidos vuelven al valor por defecto). */
export function parseAuditFilters(raw: Record<string, string | string[] | undefined>): AuditFilters {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const f = filtersSchema.parse({ rango: one(raw.rango), gravedad: one(raw.gravedad), categoria: one(raw.categoria) || undefined, persona: one(raw.persona) || undefined, pagina: one(raw.pagina) });
  return { range: f.rango, severity: f.gravedad, category: f.categoria, actor: f.persona, page: f.pagina };
}

/** Ventana de tiempo [from, to) en la zona horaria del negocio: del inicio del día más antiguo hasta mañana. */
export function auditWindow(range: AuditRangeKey, timeZone: string, now = new Date()) {
  const today = localDay(now, timeZone);
  return {
    from: localMidnight(addDays(today, -(AUDIT_RANGES[range].days - 1)), timeZone),
    to: localMidnight(addDays(today, 1), timeZone),
  };
}

type Query = {
  in: (col: string, v: readonly string[]) => Query;
  eq: (col: string, v: string) => Query;
  is: (col: string, v: null) => Query;
};
/** Aplica a una consulta los filtros de gravedad, categoría y persona. */
function applyFilters<T>(query: T, f: Pick<AuditFilters, 'severity' | 'category' | 'actor'>): T {
  let q = query as unknown as Query;
  if (f.severity === 'relevant') q = q.in('severity', ['important', 'critical']);
  if (f.severity === 'critical') q = q.eq('severity', 'critical');
  if (f.category) q = q.eq('category', f.category);
  if (f.actor === 'sistema') q = q.is('actor_id', null);
  else if (f.actor) q = q.eq('actor_id', f.actor);
  return q as unknown as T;
}

export type AuditRow = {
  id: string;
  at: string;
  actor_id: string | null;
  actor_name: string | null;
  actor_role: string | null;
  action: string;
  category: AuditCategory;
  severity: AuditSeverity;
  entity: string | null;
  entity_id: string | null;
  details: Record<string, unknown>;
};

export async function getAuditLog(ctx: TenantContext, f: AuditFilters) {
  const { from, to } = auditWindow(f.range, ctx.tenant.timezone);
  const offset = (f.page - 1) * PAGE_SIZE;
  const base = ctx.supabase
    .from('audit_log')
    .select('*', { count: 'exact' })
    .eq('tenant_id', ctx.tenant.id)
    .gte('at', from.toISOString())
    .lt('at', to.toISOString());
  const [rows, summary, people] = await Promise.all([
    applyFilters(base, f).order('at', { ascending: false }).range(offset, offset + PAGE_SIZE - 1),
    ctx.supabase.rpc('get_audit_summary', { p_from: from.toISOString(), p_to: to.toISOString() }),
    ctx.supabase.from('profiles').select('id, full_name, role').eq('tenant_id', ctx.tenant.id).order('full_name'),
  ]);
  if (rows.error) throw rows.error;
  if (summary.error) throw summary.error;
  if (people.error) throw people.error;

  const s = summary.data as unknown as {
    by_severity: Partial<Record<AuditSeverity, number>>;
    by_actor: Array<{ actor_id: string | null; name: string | null; role: string | null; action: string; n: number }>;
  };
  const totals: ActorTotals[] = summarizeByActor(s.by_actor);
  return {
    rows: rows.data as unknown as AuditRow[],
    total: rows.count ?? 0,
    page: f.page,
    pageSize: PAGE_SIZE,
    from,
    to,
    severity: { info: s.by_severity.info ?? 0, important: s.by_severity.important ?? 0, critical: s.by_severity.critical ?? 0 },
    byActor: totals,
    people: people.data,
  };
}

/** Cuántos eventos críticos e importantes hay hoy (para el aviso de la portada). */
export async function getAuditToday(ctx: TenantContext) {
  const { from, to } = auditWindow('hoy', ctx.tenant.timezone);
  const { data, error } = await ctx.supabase.rpc('get_audit_summary', { p_from: from.toISOString(), p_to: to.toISOString() });
  if (error) throw error;
  const s = data as unknown as { by_severity: Partial<Record<AuditSeverity, number>> };
  return { critical: s.by_severity.critical ?? 0, important: s.by_severity.important ?? 0 };
}

/** Para exportar: hasta `limit` filas del mismo periodo y filtros, de la más reciente a la más antigua. */
export async function getAuditExport(ctx: TenantContext, f: AuditFilters, limit = 5000) {
  const { from, to } = auditWindow(f.range, ctx.tenant.timezone);
  const base = ctx.supabase
    .from('audit_log')
    .select('*')
    .eq('tenant_id', ctx.tenant.id)
    .gte('at', from.toISOString())
    .lt('at', to.toISOString());
  const { data, error } = await applyFilters(base, f).order('at', { ascending: false }).limit(limit);
  if (error) throw error;
  return data as unknown as AuditRow[];
}
