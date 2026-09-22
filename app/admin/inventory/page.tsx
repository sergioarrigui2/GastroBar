import { InventoryManager } from '@/components/admin/InventoryManager';
import { getInventoryOverview } from '@/lib/services/inventory';
import { requirePageRole } from '@/lib/tenant-context';

export const metadata = { title: 'Inventario' };

export default async function InventoryPage() {
  const ctx = await requirePageRole(['admin']);
  const overview = await getInventoryOverview(ctx);
  return (
    <InventoryManager
      tenantId={ctx.tenant.id}
      overview={overview}
      currency={ctx.tenant.currency}
      locale={ctx.tenant.locale}
    />
  );
}
