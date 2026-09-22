import { FloorManager } from '@/components/admin/FloorManager';
import { requirePageRole } from '@/lib/tenant-context';

export const metadata = { title: 'Salón y mesas' };

export default async function FloorPage() {
  const ctx = await requirePageRole(['admin']);
  const [zones, tables] = await Promise.all([
    ctx.supabase.from('zones').select('*').eq('tenant_id', ctx.tenant.id).order('sort_order').order('name'),
    ctx.supabase.from('tables').select('*').eq('tenant_id', ctx.tenant.id).order('sort_order').order('label'),
  ]);
  if (zones.error) throw zones.error;
  if (tables.error) throw tables.error;
  return <FloorManager zones={zones.data} tables={tables.data} />;
}
