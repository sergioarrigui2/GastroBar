import { NextResponse } from 'next/server';
import { actorLabel, CATEGORY_LABEL, describeAudit, SEVERITY_LABEL } from '@/lib/audit/describe';
import { PERMISSION_INFO } from '@/lib/permissions';
import { getAuditExport, parseAuditFilters } from '@/lib/services/audit';
import { getTenantContext, TenantContextError } from '@/lib/tenant-context';
import { formatCurrency } from '@/lib/utils';

export const dynamic = 'force-dynamic';

const cell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;

/** Exporta la auditoría (mismos filtros de la pantalla) a CSV para Excel. Sólo el administrador. */
export async function GET(request: Request) {
  try {
    const ctx = await getTenantContext();
    if (ctx.role !== 'admin') return NextResponse.json({ error: 'Sólo el administrador puede exportar la auditoría' }, { status: 403 });

    const url = new URL(request.url);
    const filters = parseAuditFilters(Object.fromEntries(url.searchParams));
    const rows = await getAuditExport(ctx, filters);
    const money = (n: number) => formatCurrency(n, ctx.tenant.currency, ctx.tenant.locale);
    const permissionLabels = Object.fromEntries(Object.entries(PERMISSION_INFO).map(([k, v]) => [k, v.label]));
    const when = new Intl.DateTimeFormat(ctx.tenant.locale, { dateStyle: 'short', timeStyle: 'medium', timeZone: ctx.tenant.timezone });

    const header = ['Fecha y hora', 'Gravedad', 'Tema', 'Persona', 'Rol', 'Qué pasó', 'Detalle'];
    const lines = rows.map((r) => {
      const who = actorLabel(r);
      return [when.format(new Date(r.at)).replace(/[  ]/g, ' '), SEVERITY_LABEL[r.severity], CATEGORY_LABEL[r.category], who.name, who.role ?? '', describeAudit(r, money, { permissionLabels }), JSON.stringify(r.details)];
    });
    const csv = '﻿' + [header, ...lines].map((l) => l.map(cell).join(';')).join('\r\n');
    const stamp = new Date().toISOString().slice(0, 10);
    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="auditoria-${ctx.tenant.slug}-${stamp}.csv"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    if (error instanceof TenantContextError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
