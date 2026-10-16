import { AuditView } from '@/components/admin/audit/AuditView';
import { getAuditLog, parseAuditFilters } from '@/lib/services/audit';
import { requirePageRole } from '@/lib/tenant-context';

export const metadata = { title: 'Auditoría' };
export const dynamic = 'force-dynamic';

export default async function AuditPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requirePageRole(['admin']);
  const filters = parseAuditFilters(await searchParams);
  const data = await getAuditLog(ctx, filters);
  return <AuditView data={data} filters={filters} currency={ctx.tenant.currency} locale={ctx.tenant.locale} timezone={ctx.tenant.timezone} />;
}
